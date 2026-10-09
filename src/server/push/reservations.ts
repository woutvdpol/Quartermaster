import "server-only";
import { db } from "@/server/db";
import { isPushConfigured } from "./config";
import { pushCopy } from "./copy";
import { queuePush } from "./service";
import { RESERVATION_MIN_LEFT_MS, RESERVATION_WARNING_MS, dedupeKeys, quietHoursEnd } from "./rules";

/*
 * Cron `push.reservations` (every minute): "your reservation ends soon". Carts of logged-in customers
 * (pushReservation on, at least one device) whose earliest ACTIVE hold lapses within
 * RESERVATION_WARNING_MS and that are not in checkout (reservation not moved to an order).
 * Once per cart per expiry minute (dedupe key); skipped in the customer's quiet hours (a late warning
 * is useless, so it is not queued).
 */
export async function scanEndingReservations(now = new Date()): Promise<{ carts: number; queued: number }> {
  if (!isPushConfigured()) return { carts: 0, queued: 0 };
  const rows = await db.reservation.findMany({
    where: {
      status: "ACTIVE",
      orderId: null,
      expiresAt: { gt: new Date(now.getTime() + RESERVATION_MIN_LEFT_MS), lte: new Date(now.getTime() + RESERVATION_WARNING_MS) },
      tenant: { status: "ACTIVE" },
      cart: { customer: { pushReservation: true, pushSubscriptions: { some: { failedAt: null } } } },
    },
    select: { cartId: true },
    distinct: ["cartId"],
    take: 2000,
  });
  const cartIds = rows.map((r) => r.cartId).filter((id): id is string => !!id);
  if (!cartIds.length) return { carts: 0, queued: 0 };

  const carts = await db.cart.findMany({
    where: { id: { in: cartIds }, customerId: { not: null } },
    select: {
      id: true,
      tenantId: true,
      customerId: true,
      tenant: { select: { timezone: true } },
      customer: { select: { pushQuietStart: true, pushQuietEnd: true } },
      reservations: { where: { status: "ACTIVE" }, select: { expiresAt: true, orderId: true } },
    },
  });

  let queued = 0;
  for (const cart of carts) {
    // A hold already moved to an order = checkout started: no warning for this cart.
    if (!cart.customerId || !cart.customer || cart.reservations.some((r) => r.orderId)) continue;
    const live = cart.reservations.filter((r) => r.expiresAt.getTime() > now.getTime());
    if (!live.length) continue;
    const first = live.reduce((a, b) => (b.expiresAt < a.expiresAt ? b : a)).expiresAt;
    if (quietHoursEnd(now, cart.tenant.timezone, cart.customer.pushQuietStart, cart.customer.pushQuietEnd)) continue;
    const text = pushCopy.reservationEnding({ items: live.length, minutesLeft: Math.ceil((first.getTime() - now.getTime()) / 60_000) });
    try {
      const ok = await queuePush({
        tenantId: cart.tenantId,
        customerId: cart.customerId,
        kind: "RESERVATION_ENDING",
        ...text,
        url: "/cart",
        dedupeKey: dedupeKeys.reservation(cart.id, first),
      });
      if (ok) queued++;
    } catch (err) {
      console.error("[push] reservation warning failed", err);
    }
  }
  return { carts: carts.length, queued };
}
