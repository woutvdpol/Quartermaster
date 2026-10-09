import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import type { ProductStatus } from "@/generated/prisma/enums";
import { ServiceError, type ServiceContext } from "@/server/context";
import { getProvenance, updateProvenance } from "@/server/provenance/provenance";

/*
 * Product lineage (docs/duplicate-check.md): Product.previousProductId links a new listing to an
 * earlier listing of the same physical piece (bought back, returned). Admin only — the shop shows
 * nothing of it. Audit action "product.lineage".
 */

const idSchema = z.string().min(1).max(64);
/** Longest chain followed when checking for cycles (a piece rarely comes back this often). */
const MAX_CHAIN = 50;

export type LineageRef = { id: string; stockCode: number; title: string; status: ProductStatus; soldAt: Date | null; hasProvenance: boolean };
export type Lineage = { previous: LineageRef | null; later: LineageRef[] };

const refSelect = { id: true, stockCode: true, title: true, status: true, soldAt: true, provenance: true } as const;
const toRef = (p: { id: string; stockCode: number; title: string; status: ProductStatus; soldAt: Date | null; provenance: string | null }): LineageRef => ({
  id: p.id,
  stockCode: p.stockCode,
  title: p.title,
  status: p.status,
  soldAt: p.soldAt,
  hasProvenance: !!p.provenance?.trim(),
});

/** The earlier listing of a product and the later listings that point at it. */
export async function getLineage(ctx: ServiceContext, productId: string): Promise<Lineage> {
  productId = idSchema.parse(productId);
  const p = await db.product.findFirst({
    where: { id: productId, tenantId: ctx.tenantId },
    select: {
      previousProduct: { select: { ...refSelect, tenantId: true } },
      laterProducts: { where: { tenantId: ctx.tenantId }, select: refSelect, orderBy: { createdAt: "asc" }, take: 20 },
    },
  });
  if (!p) throw new ServiceError("NOT_FOUND", "Product not found");
  const prev = p.previousProduct && p.previousProduct.tenantId === ctx.tenantId ? p.previousProduct : null;
  return { previous: prev ? toRef(prev) : null, later: p.laterProducts.map(toRef) };
}

/**
 * Marks `previousProductId` as the earlier listing of the same piece (null removes the link).
 * Both products must belong to the tenant; a product cannot follow itself or one of its own
 * later listings (no cycles).
 */
export async function setPreviousProduct(ctx: ServiceContext, productId: string, previousProductId: string | null): Promise<Lineage> {
  productId = idSchema.parse(productId);
  const prevId = previousProductId === null ? null : idSchema.parse(previousProductId);
  const product = await db.product.findFirst({ where: { id: productId, tenantId: ctx.tenantId }, select: { id: true, stockCode: true, previousProductId: true } });
  if (!product) throw new ServiceError("NOT_FOUND", "Product not found");
  let prevStockCode: number | null = null;
  if (prevId !== null) {
    if (prevId === productId) throw new ServiceError("INVALID", "A product cannot be its own earlier listing.");
    const prev = await db.product.findFirst({ where: { id: prevId, tenantId: ctx.tenantId }, select: { id: true, stockCode: true } });
    if (!prev) throw new ServiceError("NOT_FOUND", "Earlier listing not found");
    prevStockCode = prev.stockCode;
    // Walk the chain up from the new previous product: it must not lead back to this product.
    let cur: string | null = prevId;
    for (let i = 0; cur && i < MAX_CHAIN; i++) {
      const row: { previousProductId: string | null } | null = await db.product.findFirst({ where: { id: cur, tenantId: ctx.tenantId }, select: { previousProductId: true } });
      cur = row?.previousProductId ?? null;
      if (cur === productId) throw new ServiceError("INVALID", "That listing is already a later listing of this product.");
    }
  }
  if (product.previousProductId !== prevId) {
    await db.product.update({ where: { id: productId }, data: { previousProductId: prevId } });
    await audit({
      action: "product.lineage",
      tenantId: ctx.tenantId,
      actorId: ctx.actor.id,
      entity: "Product",
      entityId: productId,
      data: { stockCode: product.stockCode, previousProductId: prevId, previousStockCode: prevStockCode, before: product.previousProductId },
    });
  }
  return getLineage(ctx, productId);
}

/**
 * Copies the public provenance text of the earlier listing into this product: replaces an empty
 * text, otherwise appended below a separator. Only on request (a button), never silently.
 */
export async function copyProvenanceFromPrevious(ctx: ServiceContext, productId: string): Promise<{ copied: boolean }> {
  productId = idSchema.parse(productId);
  const product = await db.product.findFirst({ where: { id: productId, tenantId: ctx.tenantId }, select: { previousProductId: true } });
  if (!product) throw new ServiceError("NOT_FOUND", "Product not found");
  if (!product.previousProductId) throw new ServiceError("INVALID", "This product has no earlier listing.");
  const [from, to] = await Promise.all([getProvenance(ctx, product.previousProductId), getProvenance(ctx, productId)]);
  const text = from.provenance.trim();
  if (!text || to.provenance.includes(text)) return { copied: false };
  const next = to.provenance.trim() ? `${to.provenance.trimEnd()}\n\n${text}` : text;
  await updateProvenance(ctx, productId, { provenance: next, authenticityGuaranteed: to.authenticityGuaranteed });
  return { copied: true };
}
