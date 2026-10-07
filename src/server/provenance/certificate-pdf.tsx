import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import sharp from "sharp";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { getTenantDisplay } from "@/server/tenant-display";
import { getStorage, isValidKey } from "@/server/media/storage";
import { CertificateDocument, type CertificatePdfData } from "@/pdf/CertificateDocument";
import type { Certificate } from "@/generated/prisma/client";
import { certificatePdfKey, parseSnapshot, readStoredBytes, verifyUrlFor } from "./certificates";

/*
 * Certificate PDF: rendered on demand (Route Handler GET /api/certificates/[code]/pdf, runtime
 * nodejs). A VALID certificate's PDF is cached in storage (Certificate.storageKey) — the snapshot is
 * immutable, so the PDF only changes when it is revoked (revokeCertificate drops the cache and the
 * PDF is then rendered with a REVOKED banner, uncached).
 * Note: cached PDFs are small (~100–300 KB) and are not counted against the storage quota.
 */

async function loadLogo(tenantId: string): Promise<CertificatePdfData["logo"]> {
  const { logoPath } = await getSettings(tenantId, "appearance");
  const key = logoPath?.startsWith("/uploads/") ? logoPath.slice("/uploads/".length) : null;
  if (!key || !isValidKey(key)) return null;
  try {
    const bytes = await readStoredBytes(key);
    if (!bytes) return null;
    // react-pdf embeds only JPEG/PNG; logos are usually WebP/PNG with transparency → PNG.
    const png = await sharp(bytes).resize({ height: 168, withoutEnlargement: true }).png().toBuffer();
    return { data: png, format: "png" };
  } catch (error) {
    console.error("[provenance] could not load the shop logo for a certificate", error);
    return null;
  }
}

async function loadPhoto(key: string | null): Promise<CertificatePdfData["photo"]> {
  if (!key || !isValidKey(key)) return null;
  const bytes = await readStoredBytes(key).catch(() => null);
  return bytes ? { data: bytes, format: "jpg" } : null;
}

export async function certificatePdfData(row: Certificate): Promise<CertificatePdfData> {
  const snapshot = parseSnapshot(row.snapshot);
  const [display, appearance, logo, photo] = await Promise.all([
    getTenantDisplay(row.tenantId),
    getSettings(row.tenantId, "appearance"),
    loadLogo(row.tenantId),
    loadPhoto(snapshot.photoKey),
  ]);
  // Prefer the host at issue time (printed certificates must keep working); fall back to the current one.
  const verifyUrl = verifyUrlFor(snapshot.shopHost ?? display?.primaryHost ?? null, row.code);
  const qrDataUrl = verifyUrl ? await QRCode.toDataURL(verifyUrl, { errorCorrectionLevel: "M", margin: 1, width: 360 }) : null;
  const issuedAtLabel = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: display?.timeZone || "Europe/Amsterdam" }).format(row.issuedAt);
  return {
    code: row.code,
    shopName: snapshot.shopName || display?.name || "",
    title: snapshot.title,
    stockCode: snapshot.stockCode,
    issuedAtLabel,
    specifications: snapshot.specifications,
    provenanceExcerpt: snapshot.provenanceExcerpt,
    authenticityGuaranteed: snapshot.authenticityGuaranteed,
    revoked: row.revokedAt !== null,
    verifyUrl,
    accentColor: appearance.colors.primary,
    photo,
    logo,
    qrDataUrl,
  };
}

export async function renderCertificatePdf(row: Certificate): Promise<Buffer> {
  const data = await certificatePdfData(row);
  return renderToBuffer(<CertificateDocument data={data} />);
}

/** The PDF bytes: from the storage cache when valid and cached, else rendered (and cached if valid). */
export async function getCertificatePdf(row: Certificate): Promise<Buffer> {
  const storage = getStorage();
  if (row.revokedAt === null && row.storageKey) {
    const cached = await readStoredBytes(row.storageKey).catch(() => null);
    if (cached) return cached;
  }
  const pdf = await renderCertificatePdf(row);
  if (row.revokedAt === null) {
    const key = certificatePdfKey(row.tenantId, row.id);
    try {
      await storage.put(key, pdf, "application/pdf");
      // Only while still valid: a concurrent revoke must not get its cache cleared-flag overwritten.
      await db.certificate.updateMany({ where: { id: row.id, revokedAt: null }, data: { storageKey: key } });
    } catch (error) {
      console.error(`[provenance] could not cache certificate PDF ${row.code}`, error);
    }
  }
  return pdf;
}
