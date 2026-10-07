import "server-only";
import { db } from "@/server/db";
import { imageUrl } from "@/server/media/product-images";
import type { CartMailLine } from "@/emails/commerce/types";
import { signCartRestore } from "./restore-token";

/*
 * Abandoned-cart reminder (consent only). Cron `cart.abandoned` (hourly) picks carts that
 *  - have items, an email AND reminderConsent (explicit checkbox at checkout — nothing else counts),
 *  - were last changed 2–24 h ago (a cart idle for longer is not chased),
 *  - did not lead to an order (no order with that email in the shop since the cart was created),
 *  - never got a reminder (abandonedMailSentAt IS NULL → at most ONE mail per cart; that is the
 *    implicit unsubscribe).
 * The claim (abandonedMailSentAt) and the queued mail are written in one transaction.
 */

export const ABANDONED_AFTER_HOURS = 2;
export const ABANDONED_UNTIL_HOURS = 24;
const BATCH = 500;

export async function findAbandonedCarts(limit = BATCH): Promise<{ id: string; tenantId: string }[]> {
  return db.$queryRaw<{ id: string; tenantId: string }[]>`
    SELECT c.id, c."tenantId"
    FROM carts c
    WHERE c."reminderConsent" AND c.email IS NOT NULL AND c."abandonedMailSentAt" IS NULL
      AND c."updatedAt" <= (now() - make_interval(hours => ${ABANDONED_AFTER_HOURS}::int)) AT TIME ZONE 'UTC'
      AND c."updatedAt" > (now() - make_interval(hours => ${ABANDONED_UNTIL_HOURS}::int)) AT TIME ZONE 'UTC'
      AND c."expiresAt" > now() AT TIME ZONE 'UTC'
      AND EXISTS (SELECT 1 FROM cart_items i WHERE i."cartId" = c.id)
      AND NOT EXISTS (
        SELECT 1 FROM orders o WHERE o."tenantId" = c."tenantId" AND o.email = c.email AND o."placedAt" >= c."createdAt"
      )
    ORDER BY c."updatedAt" ASC
    LIMIT ${limit}`;
}

/** Cron task body. Returns how many reminders were queued. */
export async function sendAbandonedCartReminders(): Promise<{ queued: number }> {
  const { queueMail } = await import("@/server/mail/queue");
  const carts = await findAbandonedCarts();
  let queued = 0;
  for (const c of carts) {
    const sent = await db.$transaction(async (tx) => {
      const claim = await tx.cart.updateMany({
        where: { id: c.id, abandonedMailSentAt: null, reminderConsent: true },
        data: { abandonedMailSentAt: new Date() },
      });
      if (claim.count === 0) return false;
      await queueMail({ tenantId: c.tenantId, template: "abandoned-cart", props: { cartId: c.id } }, { tx });
      return true;
    });
    if (sent) queued++;
  }
  return { queued };
}

/**
 * Data for the reminder mail, loaded when it is sent. Null (skip) when the cart no longer qualifies:
 * consent withdrawn, emptied, ordered meanwhile, or every item sold.
 */
export async function loadAbandonedCartMail(tenantId: string, cartId: string, baseUrl: string) {
  const cart = await db.cart.findFirst({
    where: { id: cartId, tenantId },
    select: {
      id: true,
      email: true,
      reminderConsent: true,
      createdAt: true,
      tenant: { select: { currency: true } },
      items: {
        orderBy: [{ addedAt: "asc" }, { id: "asc" }],
        select: {
          product: {
            select: {
              title: true,
              slug: true,
              stockCode: true,
              price: true,
              status: true,
              quantity: true,
              blurred: true,
              images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { storageKey: true } },
            },
          },
        },
      },
    },
  });
  if (!cart || !cart.email || !cart.reminderConsent || cart.items.length === 0) return null;
  const ordered = await db.order.count({ where: { tenantId, email: cart.email, placedAt: { gte: cart.createdAt } } });
  if (ordered > 0) return null;
  const lines: CartMailLine[] = cart.items.map(({ product: p }) => {
    const img = p.images[0];
    return {
      title: p.title,
      url: `${baseUrl}/product/${p.stockCode}/${p.slug}`,
      imageUrl: img && !p.blurred ? `${baseUrl}${imageUrl(img.storageKey, "thumb")}` : null,
      // The list price: an agreed offer price is personal and is re-applied in the restored cart.
      price: p.price,
      available: p.status === "ACTIVE" && p.quantity > 0,
    };
  });
  if (!lines.some((l) => l.available)) return null;
  const restoreUrl = `${baseUrl}/cart?restore=${encodeURIComponent(signCartRestore(cart.id))}`;
  return { to: cart.email, currency: cart.tenant.currency, lines, restoreUrl };
}
