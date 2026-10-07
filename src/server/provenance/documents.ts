import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { canAccessTenant } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { tenantStorageUsage } from "@/server/media/product-images";
import { assertValidKey, getStorage } from "@/server/media/storage";
import type { Prisma, ProductDocument } from "@/generated/prisma/client";
import type { ProductDocumentKind } from "@/generated/prisma/enums";
import { DocumentFileError, prepareDocumentFile } from "./files";

/*
 * Provenance documents (letters, photos, deactivation certificates, historic invoices).
 *
 * Storage: `{tenantId}/products/{productId}/docs/{id}.{ext}` via the media StorageDriver. Documents
 * are NOT served by /uploads (PDFs are not servable there, and the document id is 96 random bits,
 * never a guessable cuid) — every download goes through GET /api/documents/[id], which applies
 * `resolveDocumentAccess` below:
 *   - staff who may act on the document's tenant → any document;
 *   - everyone else → only `isPublic` documents of ACTIVE / RESERVED / SOLD products, and only on a
 *     host of that same tenant; sensitive (blurred) products additionally need a signed-in shop user
 *     when the shop blurs sensitive items for guests.
 *
 * Quota: document bytes count against the tenant storage quota together with product images
 * (media's tenantStorageUsage counts images only; tenantTotalStorageUsage adds documents). Uploads
 * take the same per-tenant advisory lock as image uploads, so the two cannot race past the quota.
 */

export const DOCUMENT_KINDS = ["PROVENANCE", "DEACTIVATION_CERT", "INVOICE_HISTORIC", "OTHER"] as const satisfies readonly ProductDocumentKind[];
export const PUBLIC_PRODUCT_STATUSES = ["ACTIVE", "RESERVED", "SOLD"] as const;
export const MAX_DOCUMENTS_PER_PRODUCT = 50;

export type ProductDocumentDto = {
  id: string;
  productId: string;
  kind: ProductDocumentKind;
  title: string;
  mimeType: string;
  byteSize: number;
  isPublic: boolean;
  createdAt: Date;
  /** Download URL (access-checked route handler). */
  url: string;
};

export type DocumentUpload = {
  kind: ProductDocumentKind;
  title?: string | null;
  isPublic?: boolean;
  file: { name: string; bytes: Uint8Array };
};

export function documentUrl(id: string): string {
  return `/api/documents/${encodeURIComponent(id)}`;
}

export function documentStorageKey(tenantId: string, productId: string, id: string, ext: string): string {
  const key = `${tenantId}/products/${productId}/docs/${id}.${ext}`;
  assertValidKey(key);
  return key;
}

function newDocumentId(): string {
  // 96 random bits, safe key charset; unlike a cuid it carries no timestamp/counter to guess from.
  return `d${randomBytes(12).toString("hex")}`;
}

function toDto(row: ProductDocument): ProductDocumentDto {
  return {
    id: row.id,
    productId: row.productId,
    kind: row.kind,
    title: row.title,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    isPublic: row.isPublic,
    createdAt: row.createdAt,
    url: documentUrl(row.id),
  };
}

const idSchema = z.string().min(1).max(64);
const titleSchema = z.string().trim().max(200, "Title is too long (max 200)");
const kindSchema = z.enum(DOCUMENT_KINDS, { message: "Choose a document type" });

async function requireProduct(tenantId: string, productId: string, client: Prisma.TransactionClient = db) {
  const product = await client.product.findFirst({ where: { id: productId, tenantId }, select: { id: true } });
  if (!product) throw new ServiceError("NOT_FOUND", "Product not found");
  return product;
}

/** Title from a file name: "Letter_1944.pdf" → "Letter 1944". */
export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_]+/g, " ").trim();
  return base.slice(0, 200) || "Document";
}

// ─── Storage accounting ──────────────────────────────────────────────────────

/** Bytes used by all product documents of a tenant. */
export async function tenantDocumentUsage(tenantId: string, client: Prisma.TransactionClient = db): Promise<number> {
  const agg = await client.productDocument.aggregate({ where: { tenantId }, _sum: { byteSize: true } });
  return agg._sum.byteSize ?? 0;
}

/** Images (originals + variants) + documents. */
export async function tenantTotalStorageUsage(tenantId: string, client: Prisma.TransactionClient = db): Promise<number> {
  const [images, docs] = await Promise.all([tenantStorageUsage(tenantId, client), tenantDocumentUsage(tenantId, client)]);
  return images + docs;
}

async function quotaBytes(tenantId: string): Promise<number> {
  const platform = await getSettings(tenantId, "platform");
  return Math.floor(platform.storageQuotaGb * 1024 ** 3);
}

// ─── Staff API ───────────────────────────────────────────────────────────────

export async function listProductDocuments(ctx: ServiceContext, productId: string): Promise<ProductDocumentDto[]> {
  productId = idSchema.parse(productId);
  await requireProduct(ctx.tenantId, productId);
  const rows = await db.productDocument.findMany({
    where: { tenantId: ctx.tenantId, productId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toDto);
}

/** Validates, stores and registers one document. Enforces the tenant storage quota. */
export async function addProductDocument(ctx: ServiceContext, productId: string, input: DocumentUpload): Promise<ProductDocumentDto> {
  productId = idSchema.parse(productId);
  const parsed = z
    .object({
      kind: kindSchema,
      title: titleSchema.nullish(),
      isPublic: z.boolean().default(false),
      file: z.object({ name: z.string().max(255), bytes: z.instanceof(Uint8Array) }),
    })
    .safeParse(input);
  if (!parsed.success) {
    throw new ServiceError("INVALID", parsed.error.issues[0]?.message ?? "Invalid document", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const { kind, isPublic, file } = parsed.data;
  const title = parsed.data.title || titleFromFilename(file.name);
  const tenantId = ctx.tenantId;
  await requireProduct(tenantId, productId);

  let prepared;
  try {
    prepared = await prepareDocumentFile(file.bytes);
  } catch (error) {
    if (error instanceof DocumentFileError) {
      throw new ServiceError("INVALID", `${file.name || "File"}: ${error.message}`, { field: "file", reason: error.reason });
    }
    throw error;
  }

  const quota = await quotaBytes(tenantId);
  const id = newDocumentId();
  const storageKey = documentStorageKey(tenantId, productId, id, prepared.ext);
  const storage = getStorage();
  await storage.put(storageKey, prepared.data, prepared.mimeType);

  try {
    const row = await db.$transaction(async (tx) => {
      // Same lock as image uploads (media/product-images.ts): quota checks are serialised per tenant.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`media:${tenantId}`}))) l`;
      await requireProduct(tenantId, productId, tx);
      const count = await tx.productDocument.count({ where: { tenantId, productId } });
      if (count >= MAX_DOCUMENTS_PER_PRODUCT) {
        throw new ServiceError("CONFLICT", `A product can have at most ${MAX_DOCUMENTS_PER_PRODUCT} documents`);
      }
      const used = await tenantTotalStorageUsage(tenantId, tx);
      if (used + prepared.data.byteLength > quota) {
        throw new ServiceError("CONFLICT", "Storage quota exceeded", { quotaBytes: quota, usedBytes: used, requestedBytes: prepared.data.byteLength });
      }
      return tx.productDocument.create({
        data: { id, tenantId, productId, kind, title, storageKey, mimeType: prepared.mimeType, byteSize: prepared.data.byteLength, isPublic },
      });
    });
    await audit({
      action: "product.document.added",
      tenantId,
      actorId: ctx.actor.id,
      entity: "ProductDocument",
      entityId: row.id,
      data: { productId, kind, isPublic, bytes: row.byteSize },
    });
    return toDto(row);
  } catch (error) {
    await storage.delete(storageKey).catch(() => {});
    throw error;
  }
}

export type DocumentPatch = { title?: string; kind?: ProductDocumentKind; isPublic?: boolean };

export async function updateProductDocument(ctx: ServiceContext, documentId: string, patch: DocumentPatch): Promise<ProductDocumentDto> {
  documentId = idSchema.parse(documentId);
  const parsed = z
    .object({ title: titleSchema.min(1, "Enter a title").optional(), kind: kindSchema.optional(), isPublic: z.boolean().optional() })
    .strict()
    .safeParse(patch);
  if (!parsed.success) {
    throw new ServiceError("INVALID", parsed.error.issues[0]?.message ?? "Invalid document", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const found = await db.productDocument.findFirst({ where: { id: documentId, tenantId: ctx.tenantId } });
  if (!found) throw new ServiceError("NOT_FOUND", "Document not found");
  const row = await db.productDocument.update({ where: { id: found.id }, data: parsed.data });
  await audit({
    action: "product.document.updated",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "ProductDocument",
    entityId: row.id,
    data: { productId: row.productId, ...parsed.data },
  });
  return toDto(row);
}

/** Deletes the row, then the file (an orphaned file is harmless, a row without file is not). */
export async function deleteProductDocument(ctx: ServiceContext, documentId: string): Promise<void> {
  documentId = idSchema.parse(documentId);
  const found = await db.productDocument.findFirst({ where: { id: documentId, tenantId: ctx.tenantId } });
  if (!found) throw new ServiceError("NOT_FOUND", "Document not found");
  await db.productDocument.delete({ where: { id: found.id } });
  await getStorage()
    .delete(found.storageKey)
    .catch((err) => console.error(`[provenance] could not delete ${found.storageKey}`, err));
  await audit({
    action: "product.document.deleted",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "ProductDocument",
    entityId: found.id,
    data: { productId: found.productId, kind: found.kind, title: found.title },
  });
}

/** Whether a product has at least one document of `kind` (e.g. DEACTIVATION_CERT for compliance). */
export async function hasProductDocument(tenantId: string, productId: string, kind: ProductDocumentKind): Promise<boolean> {
  return (await db.productDocument.count({ where: { tenantId, productId, kind } })) > 0;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export type PublicDocument = { id: string; kind: ProductDocumentKind; title: string; mimeType: string; byteSize: number; url: string };

/** Public documents of a publicly visible product (empty for drafts/archived/unknown products). */
export async function listPublicDocuments(tenantId: string, productId: string): Promise<PublicDocument[]> {
  const rows = await db.productDocument.findMany({
    where: { tenantId, productId, isPublic: true, product: { status: { in: [...PUBLIC_PRODUCT_STATUSES] } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, kind: true, title: true, mimeType: true, byteSize: true },
  });
  return rows.map((r) => ({ ...r, url: documentUrl(r.id) }));
}

export type DocumentRequester = {
  /** The signed-in user (any role), or null. */
  user: Pick<SessionUser, "id" | "role" | "tenantId"> | null;
  /** Tenant that owns the request host (getRequestTenant), or null on the platform / unknown host. */
  hostTenantId: string | null;
};

export type DocumentAccess = {
  document: Pick<ProductDocument, "id" | "tenantId" | "productId" | "title" | "storageKey" | "mimeType" | "byteSize" | "isPublic">;
  via: "staff" | "public";
};

/**
 * Who may download a document (see the header of this file). Returns null when the requester may
 * not — callers answer 404 either way, so a private document's existence is never revealed.
 */
export async function resolveDocumentAccess(documentId: string, requester: DocumentRequester): Promise<DocumentAccess | null> {
  if (!idSchema.safeParse(documentId).success) return null;
  const doc = await db.productDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      tenantId: true,
      productId: true,
      title: true,
      storageKey: true,
      mimeType: true,
      byteSize: true,
      isPublic: true,
      product: { select: { status: true, blurred: true } },
    },
  });
  if (!doc) return null;
  const { product, ...document } = doc;
  const user = requester.user;

  if (user && (user.role === "SUPERADMIN" || user.role === "OWNER") && canAccessTenant(user, doc.tenantId)) {
    return { document, via: "staff" };
  }
  if (!doc.isPublic || requester.hostTenantId !== doc.tenantId) return null;
  if (!(PUBLIC_PRODUCT_STATUSES as readonly string[]).includes(product.status)) return null;
  if (product.blurred) {
    const signedIn = !!user && user.tenantId === doc.tenantId && (user.role === "CUSTOMER" || user.role === "OWNER");
    if (!signedIn && (await getSettings(doc.tenantId, "legal")).blurSensitiveForGuests) return null;
  }
  return { document, via: "public" };
}

const DOWNLOAD_EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** RFC 6266 Content-Disposition (inline) for a document download: ASCII fallback + UTF-8 name. */
export function contentDisposition(title: string, mimeType: string): string {
  const ext = DOWNLOAD_EXT[mimeType] ?? "bin";
  const base = title.replace(/[\r\n"\\/]+/g, " ").trim().slice(0, 120) || "document";
  const ascii = base.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim() || "document";
  return `inline; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(`${base}.${ext}`).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
