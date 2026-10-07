import "server-only";
import { db } from "@/server/db";
import type { FulfillmentStatus, PaymentStatus } from "@/generated/prisma/enums";

/*
 * Order history for the account pages. Covers orders linked to the Customer and (defensively) guest
 * orders with the same email that weren't linked yet. Only customer-facing fields are selected —
 * never purchase prices, internal notes or legacyData.
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
      OR: [{ customerId: owner.customerId }, { customerId: null, email: owner.email }],
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

export type OrderStatusLabel = { label: string; tone: "neutral" | "success" | "warning" | "danger" };

/** Customer-facing status of an order (one label combining payment and fulfillment). */
export function orderStatusLabel(o: Pick<CustomerOrderRow, "paymentStatus" | "fulfillmentStatus" | "canceledAt">): OrderStatusLabel {
  if (o.canceledAt || o.paymentStatus === "CANCELED") return { label: "Canceled", tone: "danger" };
  switch (o.paymentStatus) {
    case "FAILED":
      return { label: "Payment failed", tone: "danger" };
    case "EXPIRED":
      return { label: "Payment expired", tone: "danger" };
    case "REFUNDED":
      return { label: "Refunded", tone: "neutral" };
    case "PARTIALLY_REFUNDED":
      return { label: "Partially refunded", tone: "neutral" };
    case "PENDING":
      return { label: "Awaiting payment", tone: "warning" };
  }
  switch (o.fulfillmentStatus) {
    case "DELIVERED":
      return { label: "Delivered", tone: "success" };
    case "SHIPPED":
      return { label: "Shipped", tone: "success" };
    case "PACKED":
      return { label: "Packed", tone: "neutral" };
    default:
      return { label: "Paid — processing", tone: "neutral" };
  }
}
