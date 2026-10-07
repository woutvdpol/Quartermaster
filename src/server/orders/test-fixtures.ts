// Test-only fixtures for the orders/customers/purchasing integration tests. Writes rows directly
// with `db` so the tests don't depend on catalog/checkout services.
import { db } from "@/server/db";
import type { PaymentStatus } from "@/generated/prisma/enums";

let seq = 0;
const next = () => ++seq;

export async function makeProduct(
  tenantId: string,
  opts: { price?: number; purchasePrice?: number | null; quantity?: number; categoryId?: string | null; purchaseRecordId?: string | null; title?: string } = {},
) {
  const n = next();
  return db.product.create({
    data: {
      tenantId,
      stockCode: 50000 + n,
      slug: `product-${n}`,
      title: opts.title ?? `Product ${n}`,
      status: "ACTIVE",
      price: opts.price ?? 10000,
      purchasePrice: opts.purchasePrice ?? null,
      quantity: opts.quantity ?? 1,
      categoryId: opts.categoryId ?? null,
      purchaseRecordId: opts.purchaseRecordId ?? null,
    },
  });
}

type LineSpec = { product: { id: string; title: string; stockCode: number; price: number; purchasePrice: number | null }; quantity?: number; unitPrice?: number };

export async function makeOrder(
  tenantId: string,
  opts: {
    lines: LineSpec[];
    paymentStatus?: PaymentStatus;
    shippingTotal?: number;
    surchargeTotal?: number;
    customerId?: string | null;
    email?: string;
    name?: string;
    placedAt?: Date;
    paidAt?: Date | null;
    /** Create ACTIVE reservations for the lines (as checkout would). */
    reserve?: boolean;
    /** Create a MOLLIE payment attempt with this provider id. */
    molliePaymentId?: string;
    finalized?: boolean;
  },
) {
  const n = next();
  const lines = opts.lines.map((l, i) => {
    const quantity = l.quantity ?? 1;
    const unitPrice = l.unitPrice ?? l.product.price;
    return {
      tenantId,
      productId: l.product.id,
      title: l.product.title,
      stockCode: l.product.stockCode,
      unitPrice,
      quantity,
      lineTotal: unitPrice * quantity,
      purchasePriceSnapshot: l.product.purchasePrice,
      sortOrder: i,
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const shippingTotal = opts.shippingTotal ?? 695;
  const surchargeTotal = opts.surchargeTotal ?? 0;
  const paymentStatus = opts.paymentStatus ?? "PENDING";
  const placedAt = opts.placedAt ?? new Date();
  const order = await db.order.create({
    data: {
      tenantId,
      number: 1000 + n,
      customerId: opts.customerId ?? null,
      email: opts.email ?? `buyer${n}@example.test`,
      customerName: opts.name ?? `Buyer ${n}`,
      phone: "+31600000000",
      currency: "EUR",
      subtotal,
      shippingTotal,
      surchargeTotal,
      total: subtotal + shippingTotal + surchargeTotal,
      paymentStatus,
      paymentMethod: opts.molliePaymentId ? "ideal" : "BANK_TRANSFER",
      placedAt,
      paidAt: paymentStatus === "PAID" ? (opts.paidAt ?? placedAt) : null,
      finalizedAt: opts.finalized ? new Date() : null,
    },
  });
  await db.orderLine.createMany({ data: lines.map((l) => ({ ...l, orderId: order.id })) });
  await db.orderAddress.create({
    data: {
      tenantId,
      orderId: order.id,
      type: "SHIPPING",
      firstName: "Jan",
      lastName: "Jansen",
      street: "Kerkstraat",
      houseNumber: "1",
      postalCode: "1234AB",
      city: "Utrecht",
      countryCode: "NL",
    },
  });
  if (opts.reserve) {
    for (const l of opts.lines) {
      await db.reservation.create({
        data: { tenantId, productId: l.product.id, orderId: order.id, quantity: l.quantity ?? 1, expiresAt: new Date(Date.now() + 15 * 60_000) },
      });
    }
  }
  if (opts.molliePaymentId) {
    await db.payment.create({
      data: { tenantId, orderId: order.id, provider: "MOLLIE", providerPaymentId: opts.molliePaymentId, amount: order.total, currency: "EUR" },
    });
  }
  return order;
}
