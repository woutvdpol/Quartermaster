import "server-only";
import { db } from "@/server/db";
import type { OrderMailAddress, OrderMailData } from "@/emails/types";
import { MAIL_PATHS } from "./urls";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function countryName(code: string): string {
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

function toAddress(a: {
  firstName: string;
  lastName: string;
  company: string | null;
  street: string;
  houseNumber: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string;
  region: string | null;
  countryCode: string;
}): OrderMailAddress {
  return {
    name: `${a.firstName} ${a.lastName}`.trim(),
    company: a.company,
    lines: [
      [a.street, a.houseNumber].filter(Boolean).join(" "),
      a.line2 ?? "",
      [a.postalCode, a.city].filter(Boolean).join(" "),
      a.region ?? "",
      countryName(a.countryCode),
    ].filter((l) => l.trim() !== ""),
  };
}

/** Loads the plain data object the order mails render (tenant-scoped). Null when the order doesn't exist. */
export async function loadOrderMailData(tenantId: string, orderId: string, baseUrl: string): Promise<(OrderMailData & { id: string }) | null> {
  const order = await db.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }, addresses: true },
  });
  if (!order) return null;
  const shipping = order.addresses.find((a) => a.type === "SHIPPING");
  const billing = order.addresses.find((a) => a.type === "BILLING");
  return {
    id: order.id,
    number: order.number,
    placedAt: order.placedAt,
    currency: order.currency,
    customerName: order.customerName,
    email: order.email,
    phone: order.phone,
    lines: order.lines.map((l) => ({
      title: l.title,
      stockCode: l.stockCode,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
    subtotal: order.subtotal,
    shippingTotal: order.shippingTotal,
    surchargeTotal: order.surchargeTotal,
    surchargeLabel: order.surchargeLabel,
    discountTotal: order.discountTotal,
    couponCode: order.couponCode,
    total: order.total,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    shippingMethod: order.shippingMethod,
    shippingZoneName: order.shippingZoneName,
    shippingAddress: shipping && order.shippingMethod === "SHIP" ? toAddress(shipping) : null,
    billingAddress: billing ? toAddress(billing) : null,
    customerNote: order.customerNote,
    statusUrl: `${baseUrl}${MAIL_PATHS.orderStatus(order.uuid)}`,
  };
}
