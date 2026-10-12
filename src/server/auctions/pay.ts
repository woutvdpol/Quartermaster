import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { getSettings } from "@/server/settings";
import { imageUrl } from "@/server/media/product-images";
import { loadQuoteZones } from "@/server/shipping/quote";
import { isCountryCode, type CountryCode } from "@/server/shipping/countries";
import { requestVisitorCountry } from "@/server/compliance/country";
import { buildQuote, restrictedItemsFor, restrictedMessage, getPaymentSetup, type CheckoutQuote, type PaymentSetup } from "@/server/checkout";
import { addressSchema, fieldErrors, type FieldErrors } from "@/server/checkout/schema";
import { deliverableCountries } from "@/server/checkout/totals";
import { validatePaymentMethod } from "@/server/checkout/payment-methods";
import { getSurchargeRules } from "@/server/payments/mollie-config";
import { DAY_MS, parsePayToken, payTokenMatches } from "./shared";

/*
 * The winner's personal payment page (/auctions/pay/<token>, docs/auctions.md § Na de sluiting).
 *
 * The order (channel AUCTION, PENDING, hammer price, no shipping yet) was created when the lot closed.
 * Here the winner chooses delivery (shipping zone of the address country, compliance NO_SHIPPING →
 * pickup only) and the payment method; submitAuctionPayment writes addresses, shipping, surcharge and
 * the total onto that order, and the caller then starts the Mollie payment with the normal
 * startOrderPayment(tenantId, orderId, { host }). The webhook finalizes it like any order.
 *
 * The token is an HMAC over tenant + lot + order (./shared.ts payToken): nothing is stored, and it stops
 * working when the lot is cancelled. The pay deadline (closedAt + payDays) is shown; after it the link
 * keeps working until the dealer cancels the lot (owner decision: staff decide when to cancel).
 */

export type AuctionPayState = "ready" | "processing" | "paid" | "cancelled";

export type AuctionPayView = {
  state: AuctionPayState;
  token: string;
  lot: { id: string; lotNumber: number; auctionTitle: string };
  product: { title: string; stockCode: number; imageUrl: string | null; blurred: boolean; weightGrams: number };
  currency: string;
  hammer: number;
  payBy: Date | null;
  overdue: boolean;
  order: { id: string; uuid: string; number: number; paymentStatus: string };
  customer: { email: string; name: string; phone: string | null };
  /** The winner's saved addresses (prefill). */
  addresses: { type: "SHIPPING" | "BILLING"; firstName: string; lastName: string; company: string | null; street: string; houseNumber: string | null; line2: string | null; postalCode: string | null; city: string; region: string | null; countryCode: string; isDefault: boolean }[];
  countries: CountryCode[];
  defaultCountry: CountryCode | null;
  payment: PaymentSetup;
  termsPageSlug: string | null;
};

async function findByToken(tenantId: string, token: string) {
  const parsed = parsePayToken(token);
  if (!parsed) return null;
  const lot = await db.auctionLot.findFirst({
    where: { id: parsed.lotId, tenantId },
    select: {
      id: true,
      lotNumber: true,
      status: true,
      orderId: true,
      currentBid: true,
      closedAt: true,
      productId: true,
      auction: { select: { title: true, payDays: true } },
      product: { select: { title: true, stockCode: true, blurred: true, weightGrams: true, images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { storageKey: true } } } },
      order: {
        select: {
          id: true,
          uuid: true,
          number: true,
          paymentStatus: true,
          canceledAt: true,
          finalizedAt: true,
          currency: true,
          subtotal: true,
          email: true,
          customerName: true,
          phone: true,
          customerId: true,
          payments: { where: { provider: "MOLLIE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { status: true, expiresAt: true } },
        },
      },
    },
  });
  if (!lot || !lot.orderId || !lot.order || !payTokenMatches(tenantId, lot.id, lot.orderId, parsed.signature)) return null;
  return lot;
}

type TokenLot = NonNullable<Awaited<ReturnType<typeof findByToken>>>;

function payState(lot: TokenLot): AuctionPayState {
  const o = lot.order!;
  if (o.finalizedAt || ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(o.paymentStatus)) return "paid";
  if (o.canceledAt || lot.status === "CANCELLED") return "cancelled";
  const latest = o.payments[0];
  if (latest && (latest.status === "PENDING" || latest.status === "AUTHORIZED")) return "processing";
  return "ready";
}

/** The payment page. Null for unknown / tampered tokens. */
export async function getAuctionPayView(tenantId: string, token: string): Promise<AuctionPayView | null> {
  const lot = await findByToken(tenantId, token);
  if (!lot) return null;
  const o = lot.order!;
  const [zones, payment, checkout, general, addresses] = await Promise.all([
    loadQuoteZones(tenantId),
    getPaymentSetup(tenantId),
    getSettings(tenantId, "checkout"),
    getSettings(tenantId, "general"),
    o.customerId
      ? db.address.findMany({ where: { tenantId, customerId: o.customerId }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }], take: 10 })
      : Promise.resolve([]),
  ]);
  const countries = deliverableCountries(zones);
  const visitor = await requestVisitorCountry();
  const preferred = [addresses.find((a) => a.type === "SHIPPING")?.countryCode, visitor, general.address.country].find(
    (c): c is CountryCode => !!c && isCountryCode(c) && countries.includes(c as CountryCode),
  );
  const payBy = lot.closedAt ? new Date(lot.closedAt.getTime() + lot.auction.payDays * DAY_MS) : null;
  const img = lot.product.images[0];
  return {
    state: payState(lot),
    token,
    lot: { id: lot.id, lotNumber: lot.lotNumber, auctionTitle: lot.auction.title },
    product: { title: lot.product.title, stockCode: lot.product.stockCode, imageUrl: img ? imageUrl(img.storageKey, "card") : null, blurred: lot.product.blurred, weightGrams: lot.product.weightGrams },
    currency: o.currency,
    hammer: o.subtotal,
    payBy,
    overdue: !!payBy && payBy.getTime() < Date.now(),
    order: { id: o.id, uuid: o.uuid, number: o.number, paymentStatus: o.paymentStatus },
    customer: { email: o.email, name: o.customerName, phone: o.phone },
    addresses: addresses.map((a) => ({
      type: a.type,
      firstName: a.firstName,
      lastName: a.lastName,
      company: a.company,
      street: a.street,
      houseNumber: a.houseNumber,
      line2: a.line2,
      postalCode: a.postalCode,
      city: a.city,
      region: a.region,
      countryCode: a.countryCode,
      isDefault: a.isDefault,
    })),
    countries,
    defaultCountry: preferred ?? countries[0] ?? null,
    payment,
    termsPageSlug: checkout.termsPageSlug,
  };
}

const quoteSchema = z.object({
  countryCode: z.string().trim().toUpperCase().max(2),
  shippingOptionId: z.string().trim().max(64).nullish(),
  insurance: z.boolean().optional(),
  paymentMethod: z.string().trim().toLowerCase().max(40).nullish(),
});

async function quoteFor(tenantId: string, lot: TokenLot, input: z.output<typeof quoteSchema>, surchargeMethod: string | null) {
  const [zones, checkout, rules] = await Promise.all([loadQuoteZones(tenantId), getSettings(tenantId, "checkout"), getSurchargeRules(tenantId)]);
  const restricted = await restrictedItemsFor(tenantId, [{ productId: lot.productId, title: lot.product.title }], input.countryCode);
  // Free-shipping threshold and minimum order apply as in the shop; the hammer price is the subtotal.
  return buildQuote([lot.order!.subtotal], lot.product.weightGrams, zones, input, { ...checkout, minimumOrderCents: 0 }, lot.order!.currency, null, restricted, {
    method: surchargeMethod,
    rules,
  });
}

/** Delivery options and totals for a country (informational; submitAuctionPayment recomputes). */
export async function quoteAuctionPayment(tenantId: string, token: string, input: z.input<typeof quoteSchema>): Promise<CheckoutQuote | null> {
  const lot = await findByToken(tenantId, token);
  if (!lot) return null;
  const data = quoteSchema.parse(input);
  return (await quoteFor(tenantId, lot, data, data.paymentMethod ?? null)).quote;
}

const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean());
const submitSchema = z
  .object({
    phone: z
      .string()
      .trim()
      .min(6, "Enter your phone number")
      .max(40, "Phone number is too long")
      .regex(/^\+?[0-9 ()./-]{6,40}$/, "Enter a valid phone number"),
    shipping: addressSchema,
    billingSameAsShipping: checkbox,
    billing: z.unknown().optional(),
    shippingOptionId: z.string().trim().min(1, "Choose a shipping option").max(64),
    insurance: checkbox.default(false),
    paymentMethod: z.string().trim().toLowerCase().max(40).default(""),
    termsAccepted: checkbox.refine((v) => v, "Please accept the terms and conditions"),
    customerNote: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => v || null),
  })
  .transform((v, ctx) => {
    let billing = v.shipping;
    if (!v.billingSameAsShipping) {
      const parsed = addressSchema.safeParse(v.billing ?? {});
      if (!parsed.success) {
        for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: ["billing", ...issue.path] } as z.core.$ZodRawIssue);
        return z.NEVER;
      }
      billing = parsed.data;
    }
    return { ...v, billing };
  });
export type AuctionPaymentInput = z.input<typeof submitSchema>;

export type SubmitAuctionPaymentResult =
  | { ok: true; orderId: string; uuid: string; /** a payment was already running: just continue to it */ reused: boolean }
  | { ok: false; code: "NOT_FOUND" | "INVALID" | "PAID" | "CANCELLED" | "PROCESSING" | "NOT_CONFIGURED" | "SHIPPING" | "COMPLIANCE"; message: string; errors?: FieldErrors };

/**
 * Writes delivery, addresses, payment method and the final total onto the winner's order. The caller
 * starts the Mollie payment next: `startOrderPayment(tenantId, result.orderId, { host })`.
 */
export async function submitAuctionPayment(tenantId: string, token: string, raw: unknown): Promise<SubmitAuctionPaymentResult> {
  const lot = await findByToken(tenantId, token);
  if (!lot) return { ok: false, code: "NOT_FOUND", message: "This payment link is not valid" };
  const state = payState(lot);
  if (state === "paid") return { ok: false, code: "PAID", message: "This lot is already paid. Thank you!" };
  if (state === "cancelled") return { ok: false, code: "CANCELLED", message: "This sale was cancelled. Please contact us." };
  if (state === "processing") return { ok: false, code: "PROCESSING", message: "Your payment is being processed" };

  const parsed = submitSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID", message: "Please check the highlighted fields", errors: fieldErrors(parsed.error) };
  const input = parsed.data;

  const payment = await getPaymentSetup(tenantId);
  if (!payment.configured && !payment.devSimulation) return { ok: false, code: "NOT_CONFIGURED", message: "Payments are not configured for this shop yet. Please contact us." };
  const method = validatePaymentMethod(payment, input.paymentMethod);
  if (!method.ok) return { ok: false, code: "INVALID", message: method.message, errors: { paymentMethod: method.message } };

  const { option, quote } = await quoteFor(tenantId, lot, { countryCode: input.shipping.countryCode, shippingOptionId: input.shippingOptionId, insurance: input.insurance }, method.method);
  if (quote.restrictedItems.length && !option?.isPickup) {
    const msg = restrictedMessage(input.shipping.countryCode, quote.restrictedItems);
    return { ok: false, code: "COMPLIANCE", message: msg, errors: { "shipping.countryCode": msg } };
  }
  if (!option) {
    const msg = quote.deliverable ? "Choose one of the shipping options for your country" : (quote.unavailableReason ?? "We don't ship to this country");
    return { ok: false, code: "SHIPPING", message: msg, errors: { shippingOptionId: msg } };
  }
  const totals = quote.totals;
  const o = lot.order!;

  const res = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${o.id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    if (!rows.length) return { ok: false as const, code: "NOT_FOUND" as const, message: "This payment link is not valid" };
    const order = await tx.order.findUniqueOrThrow({ where: { id: o.id }, select: { paymentStatus: true, canceledAt: true, finalizedAt: true, uuid: true } });
    if (order.finalizedAt || order.paymentStatus === "PAID") return { ok: false as const, code: "PAID" as const, message: "This lot is already paid. Thank you!" };
    if (order.canceledAt) return { ok: false as const, code: "CANCELLED" as const, message: "This sale was cancelled. Please contact us." };
    // An attempt still open at Mollie: don't change the amount under it — continue to that payment.
    const latest = await tx.payment.findFirst({ where: { tenantId, orderId: o.id, provider: "MOLLIE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { status: true, expiresAt: true, checkoutUrl: true } });
    if (latest?.status === "OPEN" && latest.checkoutUrl && (!latest.expiresAt || latest.expiresAt.getTime() > Date.now() + 60_000)) {
      return { ok: true as const, orderId: o.id, uuid: order.uuid, reused: true };
    }
    const addr = (type: "SHIPPING" | "BILLING", a: typeof input.shipping) => ({
      tenantId,
      type,
      firstName: a.firstName,
      lastName: a.lastName,
      company: a.company,
      street: a.street,
      houseNumber: a.houseNumber,
      line2: a.line2,
      postalCode: a.postalCode,
      city: a.city,
      region: a.region,
      countryCode: a.countryCode,
      phone: input.phone,
    });
    await tx.orderAddress.deleteMany({ where: { tenantId, orderId: o.id } });
    await tx.order.update({
      where: { id: o.id },
      data: {
        phone: input.phone,
        customerName: `${input.shipping.firstName} ${input.shipping.lastName}`.trim() || undefined,
        shippingTotal: totals.shippingTotal,
        surchargeTotal: totals.surcharge,
        surchargeLabel: totals.surchargeLabel,
        surchargeDetail: totals.surchargeSnapshot ?? undefined,
        total: totals.total,
        paymentMethod: method.method,
        // A failed / expired / cancelled-at-Mollie attempt may be retried from this page.
        paymentStatus: "PENDING",
        shippingMethod: option.isPickup ? "PICKUP" : "SHIP",
        shippingZoneId: option.zoneId,
        shippingZoneName: option.name,
        customerNote: input.customerNote,
        addresses: { create: [addr("SHIPPING", input.shipping), addr("BILLING", input.billing)] },
      },
    });
    await tx.orderEvent.create({
      data: {
        tenantId,
        orderId: o.id,
        type: "auction.delivery",
        data: { from: o.paymentStatus, shippingTotal: totals.shippingTotal, insurance: totals.insurance > 0, surcharge: totals.surchargeSnapshot, total: totals.total, termsAcceptedAt: new Date().toISOString() },
      },
    });
    return { ok: true as const, orderId: o.id, uuid: order.uuid, reused: false };
  });
  if (res.ok && !res.reused) {
    await audit({ action: "auction.lot.delivery", tenantId, entity: "Order", entityId: res.orderId, data: { lotId: lot.id, total: totals.total, shippingMethod: option.isPickup ? "PICKUP" : "SHIP" } });
  }
  return res;
}
