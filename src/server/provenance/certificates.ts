import "server-only";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { canAccessTenant } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { hit, isLimited, type RateLimitRule } from "@/server/auth/rate-limit";
import { getSettings } from "@/server/settings";
import { getTenantDisplay } from "@/server/tenant-display";
import { originForHost } from "@/server/storefront/context";
import { assertValidKey, getStorage } from "@/server/media/storage";
import { Prisma, type Certificate } from "@/generated/prisma/client";
import { generateCertificateCode, normalizeCertificateCode } from "./code";
import { excerpt, markdownToPlainText } from "./excerpt";

/*
 * Certificates of authenticity.
 *
 * - issueCertificate snapshots the product facts at issue time (the certificate must keep saying what
 *   it said when printed, even if the listing is edited later) and stores its own copy of the cover
 *   photo (`{tenantId}/certificates/{id}/photo.jpg`, JPEG because react-pdf only embeds JPEG/PNG).
 * - One VALID certificate per product at a time: re-issuing = revoke + issue (CONFLICT otherwise).
 * - Only for publicly visible products (ACTIVE / RESERVED / SOLD): a certificate for a draft would
 *   also block deleting that draft (Certificate → Product is onDelete: Restrict).
 * - Codes: see code.ts; uniqueness is enforced by the DB, collisions are retried.
 * - Public verification (`verifyCertificate`) is tenant-scoped (a code of another shop is "unknown")
 *   and returns no personal data (no buyer, no issuer, no revocation reason).
 * - The PDF is rendered on demand (certificate-pdf.tsx) and cached under storageKey while valid.
 */

export const CERTIFICATE_STATUSES = ["ACTIVE", "RESERVED", "SOLD"] as const;
export const PROVENANCE_EXCERPT_CHARS = 700;
export const MAX_SNAPSHOT_SPECS = 14;
const PHOTO_EDGE = 1400;
const MAX_CODE_ATTEMPTS = 6;

export type CertificateSnapshot = {
  v: 1;
  title: string;
  stockCode: number;
  specifications: { label: string; value: string }[];
  provenanceExcerpt: string | null;
  /** Storage key of the product's cover image at issue time (may be deleted later). */
  coverImageKey: string | null;
  /** The certificate's own copy of the cover photo (JPEG), or null. */
  photoKey: string | null;
  shopName: string;
  /** Primary shop host at issue time (where the QR code points). */
  shopHost: string | null;
  issuedAt: string;
  authenticityGuaranteed: boolean;
  /** Sensitive item: the public verify page hides the photo. */
  blurred: boolean;
};

export type CertificateDto = {
  id: string;
  productId: string;
  code: string;
  issuedAt: Date;
  issuedByEmail: string | null;
  revokedAt: Date | null;
  reason: string | null;
  valid: boolean;
  snapshot: CertificateSnapshot;
  pdfUrl: string;
  verifyUrl: string | null;
};

const idSchema = z.string().min(1).max(64);

// ─── Helpers ─────────────────────────────────────────────────────────────────

let codeGenerator: () => string = () => generateCertificateCode();

/** Tests only: force codes (e.g. to provoke a collision). Pass null to restore the random generator. */
export function setCodeGeneratorForTests(fn: (() => string) | null): void {
  codeGenerator = fn ?? (() => generateCertificateCode());
}

export function certificatePdfUrl(code: string): string {
  return `/api/certificates/${encodeURIComponent(code)}/pdf`;
}

/** Absolute public verification URL on the shop's primary host (null when the shop has no domain). */
export function verifyUrlFor(host: string | null, code: string): string | null {
  return host ? `${originForHost(host)}/verify/${encodeURIComponent(code)}` : null;
}

export function certificatePhotoKey(tenantId: string, certificateId: string): string {
  const key = `${tenantId}/certificates/${certificateId}/photo.jpg`;
  assertValidKey(key);
  return key;
}

export function certificatePdfKey(tenantId: string, certificateId: string): string {
  const key = `${tenantId}/certificates/${certificateId}/certificate.pdf`;
  assertValidKey(key);
  return key;
}

export function parseSnapshot(value: Prisma.JsonValue): CertificateSnapshot {
  const s = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Partial<CertificateSnapshot>;
  return {
    v: 1,
    title: String(s.title ?? ""),
    stockCode: Number(s.stockCode ?? 0),
    specifications: Array.isArray(s.specifications) ? s.specifications.map((r) => ({ label: String(r?.label ?? ""), value: String(r?.value ?? "") })) : [],
    provenanceExcerpt: s.provenanceExcerpt ? String(s.provenanceExcerpt) : null,
    coverImageKey: s.coverImageKey ? String(s.coverImageKey) : null,
    photoKey: s.photoKey ? String(s.photoKey) : null,
    shopName: String(s.shopName ?? ""),
    shopHost: s.shopHost ? String(s.shopHost) : null,
    issuedAt: String(s.issuedAt ?? ""),
    authenticityGuaranteed: Boolean(s.authenticityGuaranteed),
    blurred: Boolean(s.blurred),
  };
}

function cleanSpecs(value: Prisma.JsonValue | null): { label: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((r) => (r && typeof r === "object" && !Array.isArray(r) ? { label: String(r.label ?? "").trim(), value: String(r.value ?? "").trim() } : null))
    .filter((r): r is { label: string; value: string } => !!r && !!r.label && !!r.value)
    .slice(0, MAX_SNAPSHOT_SPECS)
    .map((r) => ({ label: r.label.slice(0, 80), value: r.value.slice(0, 300) }));
}

export async function readStoredBytes(key: string): Promise<Buffer | null> {
  const obj = await getStorage().get(key);
  if (!obj) return null;
  return Buffer.from(await new Response(obj.body).arrayBuffer());
}

/** Stores a JPEG copy of the cover photo for the certificate; null when there is none / it fails. */
async function storeCertificatePhoto(coverKey: string | null, photoKey: string): Promise<string | null> {
  if (!coverKey) return null;
  try {
    const bytes = await readStoredBytes(coverKey);
    if (!bytes) return null;
    const jpeg = await sharp(bytes, { failOn: "error" })
      .autoOrient()
      .resize({ width: PHOTO_EDGE, height: PHOTO_EDGE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    await getStorage().put(photoKey, jpeg, "image/jpeg");
    return photoKey;
  } catch (error) {
    console.error(`[provenance] could not copy certificate photo from ${coverKey}`, error);
    return null;
  }
}

/** A unique violation on insert: `code` is the only unique column besides our 96-bit random id. */
function isCodeCollision(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function issuerEmails(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (!unique.length) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, email: true } });
  return new Map(users.map((u) => [u.id, u.email]));
}

function toDto(row: Certificate, emails: Map<string, string>): CertificateDto {
  const snapshot = parseSnapshot(row.snapshot);
  return {
    id: row.id,
    productId: row.productId,
    code: row.code,
    issuedAt: row.issuedAt,
    issuedByEmail: row.issuedById ? (emails.get(row.issuedById) ?? null) : null,
    revokedAt: row.revokedAt,
    reason: row.reason,
    valid: row.revokedAt === null,
    snapshot,
    pdfUrl: certificatePdfUrl(row.code),
    verifyUrl: verifyUrlFor(snapshot.shopHost, row.code),
  };
}

// ─── Staff API ───────────────────────────────────────────────────────────────

export async function listCertificates(ctx: ServiceContext, productId: string): Promise<CertificateDto[]> {
  productId = idSchema.parse(productId);
  const product = await db.product.findFirst({ where: { id: productId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!product) throw new ServiceError("NOT_FOUND", "Product not found");
  const rows = await db.certificate.findMany({ where: { tenantId: ctx.tenantId, productId }, orderBy: [{ issuedAt: "desc" }, { id: "desc" }] });
  const emails = await issuerEmails(rows.map((r) => r.issuedById));
  return rows.map((r) => toDto(r, emails));
}

export async function issueCertificate(ctx: ServiceContext, productId: string): Promise<CertificateDto> {
  productId = idSchema.parse(productId);
  const tenantId = ctx.tenantId;
  const product = await db.product.findFirst({
    where: { id: productId, tenantId },
    select: {
      id: true,
      title: true,
      stockCode: true,
      status: true,
      specifications: true,
      provenance: true,
      authenticityGuaranteed: true,
      blurred: true,
      images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { storageKey: true } },
    },
  });
  if (!product) throw new ServiceError("NOT_FOUND", "Product not found");
  if (!(CERTIFICATE_STATUSES as readonly string[]).includes(product.status)) {
    throw new ServiceError("INVALID", "Certificates can only be issued for items that are for sale, reserved or sold");
  }
  const existing = await db.certificate.findFirst({ where: { tenantId, productId, revokedAt: null }, select: { code: true } });
  if (existing) throw new ServiceError("CONFLICT", `Certificate ${existing.code} is still valid — revoke it before issuing a new one`);

  const [display, general] = await Promise.all([getTenantDisplay(tenantId), getSettings(tenantId, "general")]);
  if (!display) throw new ServiceError("NOT_FOUND", "Tenant not found");

  const id = `c${randomBytes(12).toString("hex")}`;
  const issuedAt = new Date();
  const coverImageKey = product.images[0]?.storageKey ?? null;
  const photoKey = await storeCertificatePhoto(coverImageKey, certificatePhotoKey(tenantId, id));
  const provenanceText = markdownToPlainText(product.provenance);
  const snapshot: CertificateSnapshot = {
    v: 1,
    title: product.title,
    stockCode: product.stockCode,
    specifications: cleanSpecs(product.specifications),
    provenanceExcerpt: provenanceText ? excerpt(provenanceText, PROVENANCE_EXCERPT_CHARS) : null,
    coverImageKey,
    photoKey,
    shopName: general.shopName || display.name,
    shopHost: display.primaryHost,
    issuedAt: issuedAt.toISOString(),
    authenticityGuaranteed: product.authenticityGuaranteed,
    blurred: product.blurred,
  };

  try {
    let row: Certificate | null = null;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !row; attempt++) {
      const code = codeGenerator();
      try {
        row = await db.$transaction(async (tx) => {
          // One valid certificate per product, also under concurrent clicks.
          await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`certificate:${productId}`}))) l`;
          const valid = await tx.certificate.findFirst({ where: { tenantId, productId, revokedAt: null }, select: { code: true } });
          if (valid) throw new ServiceError("CONFLICT", `Certificate ${valid.code} is still valid — revoke it before issuing a new one`);
          return tx.certificate.create({
            data: { id, tenantId, productId, code, issuedAt, issuedById: ctx.actor.id, snapshot: snapshot as unknown as Prisma.InputJsonValue },
          });
        });
      } catch (error) {
        if (isCodeCollision(error)) continue;
        throw error;
      }
    }
    if (!row) throw new ServiceError("UNAVAILABLE", "Could not generate a unique certificate code; please try again");

    await audit({
      action: "product.certificate.issued",
      tenantId,
      actorId: ctx.actor.id,
      entity: "Certificate",
      entityId: row.id,
      data: { productId, code: row.code },
    });
    return toDto(row, new Map([[ctx.actor.id, ctx.actor.email]]));
  } catch (error) {
    if (photoKey) await getStorage().delete(photoKey).catch(() => {});
    throw error;
  }
}

const reasonSchema = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500, "Reason is too long (max 500)");

export async function revokeCertificate(ctx: ServiceContext, certificateId: string, reason: string): Promise<CertificateDto> {
  certificateId = idSchema.parse(certificateId);
  const parsedReason = reasonSchema.safeParse(reason);
  if (!parsedReason.success) {
    throw new ServiceError("INVALID", parsedReason.error.issues[0]?.message ?? "Invalid reason", { field: "reason" });
  }
  const found = await db.certificate.findFirst({ where: { id: certificateId, tenantId: ctx.tenantId } });
  if (!found) throw new ServiceError("NOT_FOUND", "Certificate not found");
  if (found.revokedAt) throw new ServiceError("CONFLICT", "This certificate has already been revoked");

  const { count } = await db.certificate.updateMany({
    where: { id: found.id, tenantId: ctx.tenantId, revokedAt: null },
    data: { revokedAt: new Date(), reason: parsedReason.data, storageKey: null },
  });
  if (count === 0) throw new ServiceError("CONFLICT", "This certificate has already been revoked");
  // The cached PDF says "valid"; it is re-rendered with a REVOKED banner on demand.
  if (found.storageKey) await getStorage().delete(found.storageKey).catch(() => {});

  await audit({
    action: "product.certificate.revoked",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "Certificate",
    entityId: found.id,
    data: { productId: found.productId, code: found.code, reason: parsedReason.data },
  });
  const row = await db.certificate.findUniqueOrThrow({ where: { id: found.id } });
  return toDto(row, await issuerEmails([row.issuedById]));
}

/** Whether the product has a currently valid certificate (for the shop badge). */
export async function hasValidCertificate(tenantId: string, productId: string): Promise<boolean> {
  return (await db.certificate.count({ where: { tenantId, productId, revokedAt: null } })) > 0;
}

/** A certificate by code for a staff download: only when `user` may act on its tenant. */
export async function findCertificateForStaff(code: string, user: Pick<SessionUser, "role" | "tenantId"> | null): Promise<Certificate | null> {
  const normalized = normalizeCertificateCode(code);
  if (!normalized || !user || (user.role !== "SUPERADMIN" && user.role !== "OWNER")) return null;
  const row = await db.certificate.findUnique({ where: { code: normalized } });
  return row && canAccessTenant(user, row.tenantId) ? row : null;
}

// ─── Public verification ─────────────────────────────────────────────────────

export const VERIFY_RATE_LIMIT: RateLimitRule = { limit: 30, windowMs: 10 * 60 * 1000 };

export type PublicCertificate = {
  code: string;
  issuedAt: string;
  revokedAt: string | null;
  title: string;
  stockCode: number;
  shopName: string;
  /** Public URL of the certificate photo (null for sensitive items or when there is none). */
  photoUrl: string | null;
  specifications: { label: string; value: string }[];
  authenticityGuaranteed: boolean;
};

export type VerifyResult =
  | { status: "valid" | "revoked"; certificate: PublicCertificate }
  | { status: "unknown"; code: string | null }
  | { status: "rate_limited" };

/** Looks a code up within one shop. No rate limiting here — see `verifyCertificateForVisitor`. */
export async function verifyCertificate(tenantId: string, input: string): Promise<VerifyResult> {
  const code = normalizeCertificateCode(input);
  if (!code) return { status: "unknown", code: null };
  const row = await db.certificate.findUnique({ where: { code } });
  if (!row || row.tenantId !== tenantId) return { status: "unknown", code };
  const s = parseSnapshot(row.snapshot);
  return {
    status: row.revokedAt ? "revoked" : "valid",
    certificate: {
      code: row.code,
      issuedAt: row.issuedAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      title: s.title,
      stockCode: s.stockCode,
      shopName: s.shopName,
      photoUrl: s.photoKey && !s.blurred ? `/uploads/${s.photoKey}` : null,
      specifications: s.specifications,
      authenticityGuaranteed: s.authenticityGuaranteed,
    },
  };
}

/** Rate-limited lookup for the public /verify page (per client IP, every lookup counts). */
export async function verifyCertificateForVisitor(tenantId: string, input: string, ip: string | null): Promise<VerifyResult> {
  const key = `certificate-verify:${ip ?? "unknown"}`;
  if (await isLimited(key, VERIFY_RATE_LIMIT)) return { status: "rate_limited" };
  await hit(key);
  return verifyCertificate(tenantId, input);
}
