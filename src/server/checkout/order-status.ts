import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { imageUrl } from "@/server/media/product-images";
import { countryName } from "@/server/shipping/countries";
import { getMollieCredentials } from "@/server/payments/mollie-config";
import { isDevSimulationAllowed } from "./payment-methods";
import { RETRY_WINDOW_MS } from "./payment";
import { orderDisplayState, type OrderDisplayState } from "./status";
import { syncLocalMolliePayment } from "@/server/payments/mollie";
import { revalidateCatalog } from "@/server/storefront-catalog/cache";

export { orderDisplayState, type OrderDisplayState } from "./status";

/*
 * Public order status page data (/order/<uuid>). The random uuid is the only key — no numeric ids,
 * no lookups by number/email. READ-ONLY: never completes or changes an order (legacy finalized on the
 * return page). Exposes only what the customer needs: no purchase prices, notes, ids or full address.
 */

export type OrderStatusView = {
  uuid: string;
  number: number;
  placedAt: Date;
  state: OrderDisplayState;
  currency: string;
  email: string;
  lines: { title: string; quantity: number; unitPrice: number; lineTotal: number; imageUrl: string | null }[];
  subtotal: number;
  shippingTotal: number;
  total: number;
  shipping: { method: "SHIP" | "PICKUP"; option: string | null; name: string; city: string; country: string } | null;
  /** Open Mollie checkout to continue (state "waiting"). */
  continueUrl: string | null;
  /** "Try again" offered (state failed/unpaid, within window, items still free). */
  canRetry: boolean;
  /** Titles that block a retry (sold / held by someone else). */
  retryBlockedBy: string[];
  retryExpired: boolean;
  paymentsConfigured: boolean;
  devSimulation: boolean;
};

const uuidSchema = z.uuid();

/** "jo***@example.com" — enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user.slice(0, Math.min(2, user.length))}***@${domain}`;
}

export async function getOrderStatusView(tenantId: string, uuid: string): Promise<OrderStatusView | null> {
  if (!uuidSchema.safeParse(uuid).success) return null;
  if (process.env.NODE_ENV !== "production") {
    // Local dev has no reachable Mollie webhook: pull the payment status instead (no-op in production).
    const pending = await db.order.findFirst({ where: { uuid, tenantId, paymentStatus: "PENDING" }, select: { id: true } });
    if (pending && (await syncLocalMolliePayment(tenantId, pending.id))) revalidateCatalog(tenantId);
  }
  const order = await db.order.findFirst({
    where: { uuid, tenantId },
    select: {
      id: true,
      uuid: true,
      number: true,
      placedAt: true,
      paymentStatus: true,
      canceledAt: true,
      archivedAt: true,
      finalizedAt: true,
      currency: true,
      email: true,
      subtotal: true,
      shippingTotal: true,
      total: true,
      shippingMethod: true,
      shippingZoneName: true,
      lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { productId: true, title: true, quantity: true, unitPrice: true, lineTotal: true, imagePath: true } },
      addresses: { where: { type: "SHIPPING" }, select: { firstName: true, lastName: true, city: true, countryCode: true } },
      payments: { where: { provider: "MOLLIE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { status: true, checkoutUrl: true, expiresAt: true } },
    },
  });
  if (!order) return null;

  const latest = order.payments[0] ?? null;
  const state = orderDisplayState(order, latest);
  const continueUrl =
    state === "waiting" && latest?.status === "OPEN" && latest.checkoutUrl && (!latest.expiresAt || latest.expiresAt.getTime() > Date.now()) ? latest.checkoutUrl : null;

  const retryable = (state === "failed" || state === "unpaid") && !order.archivedAt && !order.canceledAt && !order.finalizedAt;
  const retryExpired = retryable && Date.now() - order.placedAt.getTime() > RETRY_WINDOW_MS;
  const retryBlockedBy: string[] = [];
  if (retryable && !retryExpired) {
    const ids = order.lines.map((l) => l.productId).filter((x): x is string => !!x);
    const products = await db.product.findMany({
      where: { tenantId, id: { in: ids } },
      select: {
        id: true,
        status: true,
        quantity: true,
        reservations: { where: { status: "ACTIVE", expiresAt: { gt: new Date() } }, select: { orderId: true }, take: 1 },
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const l of order.lines) {
      const p = l.productId ? byId.get(l.productId) : undefined;
      const heldByOther = p?.reservations[0] && p.reservations[0].orderId !== order.id;
      if (!p || p.status !== "ACTIVE" || p.quantity <= 0 || heldByOther) retryBlockedBy.push(l.title);
    }
  }

  const configured = Boolean(await getMollieCredentials(tenantId));
  const ship = order.addresses[0];
  return {
    uuid: order.uuid,
    number: order.number,
    placedAt: order.placedAt,
    state,
    currency: order.currency,
    email: maskEmail(order.email),
    lines: order.lines.map((l) => ({
      title: l.title,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      imageUrl: l.imagePath ? imageUrl(l.imagePath) : null,
    })),
    subtotal: order.subtotal,
    shippingTotal: order.shippingTotal,
    total: order.total,
    shipping: ship
      ? {
          method: order.shippingMethod,
          option: order.shippingZoneName,
          name: `${ship.firstName} ${ship.lastName}`.trim(),
          city: ship.city,
          country: countryName(ship.countryCode),
        }
      : null,
    continueUrl,
    canRetry: retryable && !retryExpired && retryBlockedBy.length === 0,
    retryBlockedBy,
    retryExpired,
    paymentsConfigured: configured,
    devSimulation: !configured && isDevSimulationAllowed() && (state === "unpaid" || state === "waiting"),
  };
}
