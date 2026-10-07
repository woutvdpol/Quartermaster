import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { getSettings } from "@/server/settings";
import { ServiceError, type ServiceContext } from "@/server/context";
import { onReservationReleased } from "@/server/alerts/hooks";
import type { Prisma } from "@/generated/prisma/client";
import type { ReservationStatus } from "@/generated/prisma/enums";

/*
 * Cart reservations (decision 18 + "Fundament": every product is unique, at most one ACTIVE
 * reservation per product, enforced by the partial unique index `reservations_active_product_key`).
 * Reservations never move stock. An ACTIVE row whose `expiresAt` has passed counts as free
 * everywhere ("live" = ACTIVE and expiresAt > now); the sweeper / next reserve flips it to EXPIRED.
 *
 * These functions are tenant-scoped by an explicit `tenantId` (shop side has no staff ctx) and take
 * an optional transaction client; without one they run in their own transaction.
 */

type Tx = Prisma.TransactionClient;

export type ReservationInfo = {
  id: string;
  productId: string;
  cartId: string | null;
  orderId: string | null;
  status: ReservationStatus;
  expiresAt: Date;
  createdAt: Date;
};

const select = { id: true, productId: true, cartId: true, orderId: true, status: true, expiresAt: true, createdAt: true } as const;

function inTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : db.$transaction(fn);
}

export type ReserveInput = {
  tenantId: string;
  productId: string;
  cartId?: string | null;
  orderId?: string | null;
  /** Override the hold time; default = settings `checkout.reservationMinutes` (5–60, default 15). */
  minutes?: number;
};

/**
 * Reserves a product for a cart/order.
 *  1. flips this product's stale ACTIVE rows to EXPIRED,
 *  2. inserts the ACTIVE row with `ON CONFLICT … DO NOTHING` on the partial unique index.
 * Using ON CONFLICT instead of catching P2002 keeps a caller's surrounding transaction usable.
 *
 * - Product must exist in the tenant, be ACTIVE and have quantity > 0, else CONFLICT ("not available").
 * - Held by someone else → CONFLICT "already reserved" (details.expiresAt).
 * - Already held by the same cart → returns the existing reservation unchanged (no extension, so a
 *   cart cannot hold an item indefinitely by re-adding it).
 */
export async function reserveProduct(input: ReserveInput, tx?: Tx): Promise<ReservationInfo> {
  const { tenantId, productId } = input;
  const cartId = input.cartId ?? null;
  const orderId = input.orderId ?? null;
  if (!cartId && !orderId) throw new ServiceError("INVALID", "A reservation needs a cartId or orderId");
  let minutes = input.minutes;
  if (minutes === undefined) minutes = (await getSettings(tenantId, "checkout")).reservationMinutes;
  if (!(minutes > 0 && minutes <= 24 * 60)) throw new ServiceError("INVALID", "Invalid reservation time");
  const holdMinutes = minutes;

  return inTx(tx, async (tx) => {
    const product = await tx.product.findFirst({ where: { id: productId, tenantId }, select: { status: true, quantity: true } });
    if (!product) throw new ServiceError("NOT_FOUND", "Product not found");
    if (product.status !== "ACTIVE" || product.quantity <= 0) throw new ServiceError("CONFLICT", "Product is not available");

    await tx.$executeRaw`
      UPDATE reservations SET status = 'EXPIRED', "releasedAt" = now(), "updatedAt" = now()
      WHERE "productId" = ${productId} AND status = 'ACTIVE' AND "expiresAt" <= now()`;

    const id = randomUUID();
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO reservations (id, "tenantId", "productId", "cartId", "orderId", quantity, status, "expiresAt", "createdAt", "updatedAt")
      VALUES (${id}, ${tenantId}, ${productId}, ${cartId}, ${orderId}, 1, 'ACTIVE',
              now() + make_interval(mins => ${holdMinutes}::int), now(), now())
      ON CONFLICT ("productId") WHERE status = 'ACTIVE' DO NOTHING
      RETURNING id`;
    if (inserted.length > 0) {
      return tx.reservation.findUniqueOrThrow({ where: { id }, select });
    }
    const existing = await tx.reservation.findFirst({ where: { productId, status: "ACTIVE" }, select });
    if (existing && ((cartId && existing.cartId === cartId) || (orderId && existing.orderId === orderId))) return existing;
    throw new ServiceError("CONFLICT", "Product is already reserved", { expiresAt: existing?.expiresAt ?? null });
  });
}

export type ReleaseTarget = { tenantId: string } & ({ reservationId: string } | { productId: string; cartId?: string | null });

/**
 * Releases ACTIVE reservation(s): by id, or for a product (optionally only when held by `cartId`).
 * Returns the number of rows released (0 when nothing was held). Each released product gets a
 * "back available" alert job (inside `tx` when given, so it only exists if that commits); the
 * releasing cart's customer is excluded from that alert.
 */
export async function releaseReservation(target: ReleaseTarget, tx?: Tx): Promise<number> {
  const where: Prisma.ReservationWhereInput = { tenantId: target.tenantId, status: "ACTIVE" };
  if ("reservationId" in target) where.id = target.reservationId;
  else {
    where.productId = target.productId;
    if (target.cartId) where.cartId = target.cartId;
  }
  const client = tx ?? db;
  const released = await client.reservation.updateManyAndReturn({
    where,
    data: { status: "RELEASED", releasedAt: new Date() },
    select: { productId: true, cartId: true },
  });
  for (const r of released) {
    const excludeCustomerId = r.cartId
      ? ((await client.cart.findUnique({ where: { id: r.cartId }, select: { customerId: true } }))?.customerId ?? null)
      : null;
    await onReservationReleased(target.tenantId, r.productId, { tx, excludeCustomerId });
  }
  return released.length;
}

/** Cron sweeper: flips every ACTIVE reservation past its expiry to EXPIRED (one tenant or all). */
export async function expireReservations(tenantId?: string): Promise<number> {
  const res = await db.reservation.updateMany({
    where: { status: "ACTIVE", expiresAt: { lte: new Date() }, ...(tenantId ? { tenantId } : {}) },
    data: { status: "EXPIRED", releasedAt: new Date() },
  });
  return res.count;
}

/** The live (ACTIVE, not expired) reservation of a product, or null. */
export async function activeReservation(tenantId: string, productId: string, tx?: Tx): Promise<ReservationInfo | null> {
  return (tx ?? db).reservation.findFirst({
    where: { tenantId, productId, status: "ACTIVE", expiresAt: { gt: new Date() } },
    select,
  });
}

/** Admin: free a product held in someone's cart. Returns whether something was released. */
export async function adminReleaseReservation(ctx: ServiceContext, productId: string): Promise<boolean> {
  const count = await releaseReservation({ tenantId: ctx.tenantId, productId });
  if (count > 0) {
    await audit({ action: "reservation.release", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Product", entityId: productId });
  }
  return count > 0;
}
