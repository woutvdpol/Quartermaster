import "server-only";
import { ServiceError } from "@/server/context";
import type { Prisma } from "@/generated/prisma/client";

type Reader = Pick<Prisma.TransactionClient, "product" | "productDocument">;

export type DeactivationBlocker = { id: string; stockCode: number; reason: string };

export const DEACTIVATION_CERT_REASON = "Deactivation certificate missing";

/**
 * Products among `productIds` (of the tenant) that require a deactivation certificate
 * (Product.requiresDeactivationCert, EU 2018/337) but have no ProductDocument of kind
 * DEACTIVATION_CERT. Shape matches the catalog's all-or-nothing status failures.
 */
export async function deactivationCertBlockers(tx: Reader, tenantId: string, productIds: readonly string[]): Promise<DeactivationBlocker[]> {
  if (!productIds.length) return [];
  const needing = await tx.product.findMany({
    where: { tenantId, id: { in: [...productIds] }, requiresDeactivationCert: true },
    select: { id: true, stockCode: true },
  });
  if (!needing.length) return [];
  const docs = await tx.productDocument.findMany({
    where: { tenantId, productId: { in: needing.map((p) => p.id) }, kind: "DEACTIVATION_CERT" },
    select: { productId: true },
    distinct: ["productId"],
  });
  const ok = new Set(docs.map((d) => d.productId));
  return needing.filter((p) => !ok.has(p.id)).map((p) => ({ id: p.id, stockCode: p.stockCode, reason: DEACTIVATION_CERT_REASON }));
}

/**
 * Guard for "set ACTIVE": throws ServiceError("INVALID") with details [{ id, stockCode, reason }]
 * when the product requires a deactivation certificate and none is on file. Call inside the status
 * transaction (catalog setStatus / create with status ACTIVE). `tenantId` is optional for callers
 * that already scoped the product; when given the lookup is tenant-scoped.
 */
export async function assertDeactivationCertOnFile(tx: Reader, productId: string, tenantId?: string): Promise<void> {
  const product = await tx.product.findFirst({
    where: { id: productId, ...(tenantId ? { tenantId } : {}) },
    select: { id: true, tenantId: true },
  });
  if (!product) return; // the caller's own not-found handling applies
  const blockers = await deactivationCertBlockers(tx, product.tenantId, [product.id]);
  if (blockers.length) {
    throw new ServiceError("INVALID", `#${blockers[0].stockCode}: ${DEACTIVATION_CERT_REASON}`, blockers);
  }
}
