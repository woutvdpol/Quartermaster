import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { queueMail } from "@/server/mail/queue";
import { queuePriceDropPushes } from "@/server/push";
import type { Prisma } from "@/generated/prisma/client";
import type { AlertKind } from "@/generated/prisma/enums";
import { verifyWishlistLink } from "./signing";

/*
 * Wishlist alerts for signed-in customers:
 *   BACK_AVAILABLE  a wishlisted ACTIVE product is free again (its cart reservation was released or
 *                   expired, and nobody else holds it now)
 *   PRICE_DROP      the price of a wishlisted ACTIVE product was lowered
 *
 * Dedupe: one AlertDelivery row per (kind, customerId, productId) — the schema's unique key. The row
 * is RE-ARMED instead of duplicated: a new alert of the same kind for the same product is sent only
 * when the row's `sentAt` is older than the cooldown (claimed atomically with
 * `updateMany … WHERE sentAt < now − cooldown`). So a second price drop after 7 days notifies again;
 * a reservation that bounces back and forth within a day notifies once.
 */

/** Wishlist mail alerts; RESERVATION_ENDING is push-only (PushMessage, docs/push.md). */
type WishlistAlertKind = Exclude<AlertKind, "SAVED_SEARCH" | "RESERVATION_ENDING">;

export const COOLDOWN_MS: Record<WishlistAlertKind, number> = {
  BACK_AVAILABLE: 24 * 60 * 60 * 1000,
  PRICE_DROP: 7 * 24 * 60 * 60 * 1000,
};

/** Claims the (kind, customer, product) slot. True = this caller must send the mail. */
export async function claimWishlistDelivery(
  kind: WishlistAlertKind,
  tenantId: string,
  customerId: string,
  productId: string,
  now = new Date(),
  tx: Prisma.TransactionClient = db,
): Promise<boolean> {
  const created = await tx.alertDelivery.createMany({
    data: [{ tenantId, kind, customerId, productId, sentAt: now }],
    skipDuplicates: true,
  });
  if (created.count) return true;
  const rearmed = await tx.alertDelivery.updateMany({
    where: { tenantId, kind, customerId, productId, OR: [{ sentAt: null }, { sentAt: { lt: new Date(now.getTime() - COOLDOWN_MS[kind]) } }] },
    data: { sentAt: now },
  });
  return rearmed.count > 0;
}

async function wishlisters(tenantId: string, productId: string, excludeCustomerId?: string | null) {
  return db.wishlistItem.findMany({
    where: { tenantId, productId, ...(excludeCustomerId ? { customerId: { not: excludeCustomerId } } : {}) },
    select: { customerId: true },
    take: 5000,
  });
}

/**
 * A product may be free again: notify wishlisters when it is ACTIVE, in stock, and has no live
 * reservation. `excludeCustomerId`: the customer whose own cart released it (no mail to them).
 */
export async function processBackAvailable(tenantId: string, productId: string, opts: { excludeCustomerId?: string | null } = {}): Promise<number> {
  const now = new Date();
  const p = await db.product.findFirst({
    where: { id: productId, tenantId, status: "ACTIVE", quantity: { gt: 0 } },
    select: { id: true, reservations: { where: { status: "ACTIVE", expiresAt: { gt: now } }, take: 1, select: { id: true } } },
  });
  if (!p || p.reservations.length) return 0;
  let sent = 0;
  for (const w of await wishlisters(tenantId, productId, opts.excludeCustomerId)) {
    const ok = await db.$transaction(async (tx) => {
      if (!(await claimWishlistDelivery("BACK_AVAILABLE", tenantId, w.customerId, productId, now, tx))) return false;
      await queueMail({ tenantId, template: "alert-back-available", props: { customerId: w.customerId, productId } }, { tx });
      return true;
    });
    if (ok) sent++;
  }
  return sent;
}

/** The price of a product was lowered: notify wishlisters (ACTIVE products only). */
export async function processPriceDrop(tenantId: string, productId: string, oldPrice: number, newPrice: number): Promise<number> {
  if (!(Number.isInteger(oldPrice) && Number.isInteger(newPrice)) || newPrice <= 0 || newPrice >= oldPrice) return 0;
  const p = await db.product.findFirst({ where: { id: productId, tenantId, status: "ACTIVE", quantity: { gt: 0 } }, select: { price: true } });
  if (!p || p.price >= oldPrice) return 0; // already raised again
  const now = new Date();
  let sent = 0;
  const notified: string[] = [];
  for (const w of await wishlisters(tenantId, productId)) {
    const ok = await db.$transaction(async (tx) => {
      if (!(await claimWishlistDelivery("PRICE_DROP", tenantId, w.customerId, productId, now, tx))) return false;
      await queueMail({ tenantId, template: "alert-price-drop", props: { customerId: w.customerId, productId, oldPrice, newPrice: p.price } }, { tx });
      return true;
    });
    if (ok) {
      sent++;
      notified.push(w.customerId);
    }
  }
  // Also a push for customers with push on (docs/push.md); the e-mail stays. Never throws.
  if (notified.length) await queuePriceDropPushes(tenantId, productId, oldPrice, p.price, notified);
  return sent;
}

/**
 * Safety net (cron `alerts.scan`): reservations released or expired in the window whose product is
 * wishlisted. Catches every release path (cart remove, order cancel, expiry sweeper, admin release,
 * status change) without hooks; the cooldown makes overlapping windows harmless.
 */
export async function scanReleasedReservations(opts: { since?: Date } = {}): Promise<{ products: number; mails: number }> {
  const since = opts.since ?? new Date(Date.now() - 15 * 60 * 1000);
  const rows = await db.reservation.findMany({
    where: {
      status: { in: ["RELEASED", "EXPIRED"] },
      releasedAt: { gte: since },
      product: { status: "ACTIVE", wishlistItems: { some: {} } },
    },
    distinct: ["productId"],
    select: { tenantId: true, productId: true },
    take: 1000,
  });
  let mails = 0;
  for (const r of rows) mails += await processBackAvailable(r.tenantId, r.productId);
  return { products: rows.length, mails };
}

/** One-click stop from a wishlist alert mail: removes the item from the wishlist (no more alerts for it). */
export async function stopWishlistAlertSigned(input: { tenantId: string; customerId: string; productId: string; sig: string }) {
  const { tenantId, customerId, productId, sig } = input;
  if (!verifyWishlistLink(tenantId, customerId, productId, sig)) return { ok: false as const, error: "invalid" as const };
  const res = await db.wishlistItem.deleteMany({ where: { tenantId, customerId, productId } });
  if (res.count) await audit({ action: "alerts.wishlist.stopped", tenantId, entity: "Product", entityId: productId });
  return { ok: true as const, changed: res.count > 0 };
}
