import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { parseInput } from "@/server/catalog/errors";
import type { Prisma } from "@/generated/prisma/client";
import type { StockMovementReason } from "@/generated/prisma/enums";

/*
 * Stock ledger. `StockMovement` is append-only; `Product.quantity` is the cached on-hand
 * stock (= Σ delta) and only ever changes through `recordMovement`, in the same transaction.
 * Cart reservations do NOT move stock (see ./reservations.ts).
 */

export type RecordMovementInput = {
  tenantId: string;
  productId: string;
  delta: number;
  reason: StockMovementReason;
  orderId?: string | null;
  reservationId?: string | null;
  actorId?: string | null;
  note?: string | null;
};

export type RecordedMovement = { id: bigint; productId: string; delta: number; quantityBefore: number; quantityAfter: number };

/**
 * Writes one ledger row and updates Product.quantity. Must be called inside the caller's
 * transaction. Locks the product row (`SELECT … FOR UPDATE`) so concurrent movements on the same
 * product serialise and `quantityAfter` is always exact.
 *
 * Throws NOT_FOUND (product not in tenant), INVALID (delta 0 for a reason other than
 * RESERVE/RELEASE, non-integer delta) or CONFLICT (stock would go negative).
 */
export async function recordMovement(tx: Prisma.TransactionClient, input: RecordMovementInput): Promise<RecordedMovement> {
  const { tenantId, productId, delta, reason } = input;
  if (!Number.isSafeInteger(delta)) throw new ServiceError("INVALID", "Stock delta must be an integer");
  if (delta === 0 && reason !== "RESERVE" && reason !== "RELEASE") {
    throw new ServiceError("INVALID", "Stock delta must not be 0");
  }
  const rows = await tx.$queryRaw<{ quantity: number }[]>`
    SELECT quantity FROM products WHERE id = ${productId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  if (rows.length === 0) throw new ServiceError("NOT_FOUND", "Product not found");
  const before = rows[0].quantity;
  const after = before + delta;
  if (after < 0) {
    throw new ServiceError("CONFLICT", `Not enough stock: ${before} on hand, change ${delta}`, { quantity: before, delta });
  }
  if (delta !== 0) {
    await tx.product.update({ where: { id: productId }, data: { quantity: after } });
  }
  const movement = await tx.stockMovement.create({
    data: {
      tenantId,
      productId,
      delta,
      quantityAfter: after,
      reason,
      orderId: input.orderId ?? null,
      reservationId: input.reservationId ?? null,
      actorId: input.actorId ?? null,
      note: input.note ?? null,
    },
    select: { id: true },
  });
  return { id: movement.id, productId, delta, quantityBefore: before, quantityAfter: after };
}

const adjustSchema = z
  .object({
    quantity: z.int().min(0).max(1_000_000).optional(),
    delta: z.int().min(-1_000_000).max(1_000_000).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => (v.quantity === undefined) !== (v.delta === undefined), "Give either quantity or delta");

export type AdjustStockInput = { quantity: number; note?: string } | { delta: number; note?: string };

/**
 * Admin stock correction (reason ADJUSTMENT). Either set the absolute on-hand `quantity` or apply a
 * `delta`. A change of 0 writes nothing and returns `movement: null`.
 */
export async function adjustStock(
  ctx: ServiceContext,
  productId: string,
  input: AdjustStockInput,
): Promise<{ quantity: number; movement: RecordedMovement | null }> {
  const data = parseInput(adjustSchema, input);
  const result = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ quantity: number }[]>`
      SELECT quantity FROM products WHERE id = ${productId} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
    if (rows.length === 0) throw new ServiceError("NOT_FOUND", "Product not found");
    const delta = data.delta ?? data.quantity! - rows[0].quantity;
    if (delta === 0) return { quantity: rows[0].quantity, movement: null };
    const movement = await recordMovement(tx, {
      tenantId: ctx.tenantId,
      productId,
      delta,
      reason: "ADJUSTMENT",
      actorId: ctx.actor.id,
      note: data.note || null,
    });
    return { quantity: movement.quantityAfter, movement };
  });
  if (result.movement) {
    await audit({
      action: "stock.adjust",
      tenantId: ctx.tenantId,
      actorId: ctx.actor.id,
      entity: "Product",
      entityId: productId,
      data: { delta: result.movement.delta, quantityAfter: result.movement.quantityAfter, note: data.note ?? null },
    });
  }
  return result;
}

export type StockMovementRow = {
  id: string;
  delta: number;
  quantityAfter: number;
  reason: StockMovementReason;
  orderId: string | null;
  note: string | null;
  actorEmail: string | null;
  createdAt: Date;
};

/** Ledger history for one product, newest first. */
export async function listMovements(ctx: ServiceContext, productId: string, opts: { limit?: number } = {}): Promise<StockMovementRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await db.stockMovement.findMany({
    where: { tenantId: ctx.tenantId, productId },
    orderBy: { id: "desc" },
    take: limit,
    include: { actor: { select: { email: true } } },
  });
  return rows.map((m) => ({
    id: m.id.toString(),
    delta: m.delta,
    quantityAfter: m.quantityAfter,
    reason: m.reason,
    orderId: m.orderId,
    note: m.note,
    actorEmail: m.actor?.email ?? null,
    createdAt: m.createdAt,
  }));
}

export type StockOverview = {
  /** ACTIVE products with stock on hand. */
  forSale: number;
  /** Live cart reservations (ACTIVE and not yet expired). */
  reservedNow: number;
  /** Products marked SOLD in the last 30 days (by soldAt). */
  sold30d: number;
  /** Σ price × quantity over inventory (status DRAFT/ACTIVE/RESERVED, quantity > 0), cents. */
  valueAtPrice: number;
  /** Σ purchasePrice × quantity over the same inventory; items without purchase price count as 0. */
  valueAtCost: number;
  /** Inventory items without a purchase price (makes valueAtCost incomplete). */
  withoutPurchasePrice: number;
};

/** Dashboard / Inventory header numbers, in one query. */
export async function stockOverview(ctx: ServiceContext): Promise<StockOverview> {
  const [row] = await db.$queryRaw<
    { forSale: number; sold30d: number; valueAtPrice: bigint | null; valueAtCost: bigint | null; withoutPurchasePrice: number; reservedNow: number }[]
  >`
    SELECT
      count(*) FILTER (WHERE p.status = 'ACTIVE' AND p.quantity > 0)::int AS "forSale",
      count(*) FILTER (WHERE p.status = 'SOLD' AND p."soldAt" >= now() - interval '30 days')::int AS "sold30d",
      coalesce(sum(p.price::bigint * p.quantity) FILTER (WHERE p.status IN ('DRAFT','ACTIVE','RESERVED') AND p.quantity > 0), 0)::bigint AS "valueAtPrice",
      coalesce(sum(coalesce(p."purchasePrice", 0)::bigint * p.quantity) FILTER (WHERE p.status IN ('DRAFT','ACTIVE','RESERVED') AND p.quantity > 0), 0)::bigint AS "valueAtCost",
      count(*) FILTER (WHERE p.status IN ('DRAFT','ACTIVE','RESERVED') AND p.quantity > 0 AND p."purchasePrice" IS NULL)::int AS "withoutPurchasePrice",
      (SELECT count(*)::int FROM reservations r
        WHERE r."tenantId" = ${ctx.tenantId} AND r.status = 'ACTIVE' AND r."expiresAt" > now()) AS "reservedNow"
    FROM products p
    WHERE p."tenantId" = ${ctx.tenantId}`;
  return {
    forSale: row.forSale,
    reservedNow: row.reservedNow,
    sold30d: row.sold30d,
    valueAtPrice: Number(row.valueAtPrice ?? 0),
    valueAtCost: Number(row.valueAtCost ?? 0),
    withoutPurchasePrice: row.withoutPurchasePrice,
  };
}
