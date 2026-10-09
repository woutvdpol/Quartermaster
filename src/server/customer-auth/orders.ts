import "server-only";
import { db } from "@/server/db";
import type { FulfillmentStatus, PaymentStatus } from "@/generated/prisma/enums";

/*
 * Order history for the account pages: only orders LINKED to the account's Customer. Guest orders
 * with the same email are linked when the address is proven (customer-auth/link.ts) — never shown
 * by email match, which an unverified account could abuse (security review R1). Only
 * customer-facing fields are selected — never purchase prices, internal notes or legacyData.
 */

export type CustomerOrderRow = {
  uuid: string;
  number: number;
  placedAt: Date;
  total: number;
  currency: string;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  canceledAt: Date | null;
  itemCount: number;
  firstItemTitle: string | null;
};

export async function listCustomerOrders(
  owner: { tenantId: string; customerId: string; email: string },
  opts: { take?: number } = {},
): Promise<CustomerOrderRow[]> {
  const rows = await db.order.findMany({
    where: {
      tenantId: owner.tenantId,
      customerId: owner.customerId,
    },
    orderBy: { placedAt: "desc" },
    take: Math.min(opts.take ?? 100, 200),
    select: {
      uuid: true,
      number: true,
      placedAt: true,
      total: true,
      currency: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      canceledAt: true,
      lines: { select: { title: true, quantity: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  return rows.map(({ lines, ...o }) => ({
    ...o,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    firstItemTitle: lines[0]?.title ?? null,
  }));
}

export type OrderStatusKey =
  | "canceled"
  | "payment_failed"
  | "payment_expired"
  | "refunded"
  | "partially_refunded"
  | "awaiting_payment"
  | "delivered"
  | "shipped"
  | "packed"
  | "processing";

/** `label` is English; shop UI translates by `key` (accountCopies.orders.statuses). */
export type OrderStatusLabel = { key: OrderStatusKey; label: string; tone: "neutral" | "success" | "warning" | "danger" };

/** Customer-facing status of an order (one label combining payment and fulfillment). */
export function orderStatusLabel(o: Pick<CustomerOrderRow, "paymentStatus" | "fulfillmentStatus" | "canceledAt">): OrderStatusLabel {
  if (o.canceledAt || o.paymentStatus === "CANCELED") return { key: "canceled", label: "Canceled", tone: "danger" };
  switch (o.paymentStatus) {
    case "FAILED":
      return { key: "payment_failed", label: "Payment failed", tone: "danger" };
    case "EXPIRED":
      return { key: "payment_expired", label: "Payment expired", tone: "danger" };
    case "REFUNDED":
      return { key: "refunded", label: "Refunded", tone: "neutral" };
    case "PARTIALLY_REFUNDED":
      return { key: "partially_refunded", label: "Partially refunded", tone: "neutral" };
    case "PENDING":
      return { key: "awaiting_payment", label: "Awaiting payment", tone: "warning" };
  }
  switch (o.fulfillmentStatus) {
    case "DELIVERED":
      return { key: "delivered", label: "Delivered", tone: "success" };
    case "SHIPPED":
      return { key: "shipped", label: "Shipped", tone: "success" };
    case "PACKED":
      return { key: "packed", label: "Packed", tone: "neutral" };
    default:
      return { key: "processing", label: "Paid — processing", tone: "neutral" };
  }
}
