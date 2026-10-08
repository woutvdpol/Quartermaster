import "server-only";
import { cache } from "react";
import { z } from "zod";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import { getSettings } from "@/server/settings";
import { nextSequenceValue } from "@/server/sequence";
import { reserveProduct } from "@/server/stock/reservations";
import { findOrCreateGuestCustomer } from "@/server/customers";
import { subscribe } from "@/server/newsletter";
import { variantKey } from "@/server/media/product-images";
import { calculateShippingQuote, type QuoteResult, type ShippingOption } from "@/server/shipping/calc";
import { loadQuoteZones } from "@/server/shipping/quote";
import { countryName, isCountryCode, type CountryCode } from "@/server/shipping/countries";
import { resolveCompliance } from "@/server/compliance";
import { getCart, getTenantCurrency, lockCart, loadCartLinesTx, summarize, type CartView, type ShopViewer } from "@/server/cart";
import type { Prisma } from "@/generated/prisma/client";
import { parseCheckoutInput, type FieldErrors } from "./schema";
import { computeTotals, deliverableCountries, freeShippingProgress, minimumOrderShortfall, selectOption, type FreeShippingProgress, type Totals } from "./totals";
import { getPaymentSetup, validatePaymentMethod, type PaymentSetup } from "./payment-methods";
import { applyCouponToTotals, evaluateCoupon, evaluateCouponForOrderTx, type CouponOutcome, type DiscountedTotals } from "@/server/coupons";
import { convertOffersTx, lockApplicableOffersTx } from "@/server/offers";
import { formatMoney } from "@/components/shop/ui/money";
import { getSurchargeRules } from "@/server/payments/mollie-config";
import { applySurcharge, type SurchargedTotals, type SurchargeRules } from "@/server/payments/surcharge";

export { getPaymentSetup, methodLabel, isDevSimulationAllowed, type PaymentSetup, type PaymentMethodOption } from "./payment-methods";
export { startOrderPayment, retryOrderPayment, simulateDevPayment, type StartPaymentResult, type RetryResult } from "./payment";
export { getOrderStatusView, type OrderStatusView } from "./order-status";
export type { FieldErrors } from "./schema";

/*
 * Checkout (docs/analysis/03 §2.5–2.6, with the legacy bugs fixed):
 *  - Prices, shipping and totals are ALWAYS computed here from DB rows; nothing the browser sends
 *    about money is read.
 *  - The shipping zone follows the country of the SHIPPING ADDRESS (legacy let the customer pick any
 *    cheaper "region"). The client only chooses among the options valid for that country.
 *  - placeOrder runs in ONE transaction: cart row lock (double submits serialise), product locks,
 *    every item re-reserved for THIS cart (fails if someone else holds it), order + lines + addresses,
 *    reservations moved onto the order for the payment window, cart emptied.
 *  - The order is only completed by the Mollie webhook (orders/commands.applyMolliePaymentStatus →
 *    finalizeOrder); the /order/<uuid> page only reads.
 */

/** How long an order keeps its items while the customer pays at Mollie. */
export const PAYMENT_HOLD_MINUTES = 30;
/** Window in which an identical submit returns the order it already created. */
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const EMPTY_CART_REUSE_WINDOW_MS = 30 * 60 * 1000;

export type CheckoutRequirements = {
  /** Guest with a sensitive (blurred) item, or guest checkout disabled. */
  loginRequired: boolean;
  loginReason: "sensitive" | "guest_checkout_off" | null;
  ageConfirmation: boolean;
  minimumAge: number;
};

export type CheckoutContext = {
  cart: CartView | null;
  currency: string;
  countries: CountryCode[];
  defaultCountry: CountryCode | null;
  payment: PaymentSetup;
  requirements: CheckoutRequirements;
  termsPageSlug: string | null;
  disclaimer: string;
  freeShippingThreshold: number;
  minimumOrder: number;
  newsletterEnabled: boolean;
  viewer: { email: string; name: string | null } | null;
};

function requirementsFor(
  lines: { blurred: boolean; ageRestricted: boolean }[],
  viewer: ShopViewer | null,
  checkout: { guestCheckout: boolean },
  legal: { blurSensitiveForGuests: boolean; ageVerification: string; minimumAge: number },
): CheckoutRequirements {
  const sensitive = !viewer && legal.blurSensitiveForGuests && lines.some((l) => l.blurred);
  const guestOff = !viewer && !checkout.guestCheckout;
  return {
    loginRequired: sensitive || guestOff,
    loginReason: sensitive ? "sensitive" : guestOff ? "guest_checkout_off" : null,
    ageConfirmation: legal.ageVerification === "checkout" && lines.some((l) => l.ageRestricted),
    minimumAge: legal.minimumAge,
  };
}

/**
 * Shipping zones for the read-only cart/checkout views, memoised per request (React cache): the cart
 * and checkout pages ask for them in getCheckoutContext AND quoteCheckout. placeOrder reads them fresh.
 */
const requestQuoteZones = cache(loadQuoteZones);

/**
 * A cart the caller already loaded in this request (the cart page reads it once and passes it on),
 * so getCheckoutContext / quoteCheckout don't run the same cart queries again. Must be the
 * getCart(tenantId, token) result for the same tenant and token.
 */
export type PreloadedCart = { cart: CartView | null };

/** Everything the checkout page needs to render (read-only). */
export async function getCheckoutContext(
  tenantId: string,
  token: string | null | undefined,
  viewer: ShopViewer | null,
  preloaded?: PreloadedCart,
): Promise<CheckoutContext> {
  const [cart, checkout, legal, general, platform, zones, payment, currency] = await Promise.all([
    preloaded ? preloaded.cart : getCart(tenantId, token),
    getSettings(tenantId, "checkout"),
    getSettings(tenantId, "legal"),
    getSettings(tenantId, "general"),
    getSettings(tenantId, "platform"),
    requestQuoteZones(tenantId),
    getPaymentSetup(tenantId),
    getTenantCurrency(tenantId),
  ]);
  const countries = deliverableCountries(zones);
  const preferred = [cart?.countryCode, general.address.country].find((c): c is CountryCode => !!c && isCountryCode(c) && countries.includes(c));
  const buyable = (cart?.lines ?? []).filter((l) => l.state === "held" || l.state === "lapsed");
  return {
    cart,
    currency,
    countries,
    defaultCountry: preferred ?? countries[0] ?? null,
    payment,
    requirements: requirementsFor(buyable, viewer, checkout, legal),
    termsPageSlug: checkout.termsPageSlug,
    disclaimer: legal.disclaimers.checkout,
    freeShippingThreshold: checkout.freeShippingThresholdCents,
    minimumOrder: checkout.minimumOrderCents,
    newsletterEnabled: platform.newsletterEnabled,
    viewer: viewer ? { email: viewer.email, name: viewer.name } : null,
  };
}

export type QuoteOptionView = {
  id: string;
  name: string;
  price: number;
  basePrice: number;
  freeShipping: boolean;
  isPickup: boolean;
  insurance: { price: number; maxInsuredValue: number | null } | null;
};

/** Totals incl. coupon and payment surcharge: total = subtotal − discount + shipping (+ insurance) + surcharge. */
export type CheckoutTotals = SurchargedTotals<DiscountedTotals<Totals>>;

/** The cart's coupon as evaluated for this quote (null = no code entered). */
export type CouponQuote = { code: string; ok: true; discount: number; freeShipping: boolean } | { code: string; ok: false; message: string };

/** A cart item a compliance rule forbids shipping to the quoted country (pickup is still possible). */
export type RestrictedItem = { productId: string; title: string };

export type CheckoutQuote = {
  countryCode: string;
  deliverable: boolean;
  /** Items that can't be shipped to `countryCode` (compliance NO_SHIPPING); delivery options are then hidden. */
  restrictedItems: RestrictedItem[];
  /** Why home delivery isn't possible (also when only pickup remains). */
  unavailableReason: string | null;
  options: QuoteOptionView[];
  selectedOptionId: string | null;
  insurance: boolean;
  totals: CheckoutTotals;
  coupon: CouponQuote | null;
  itemCount: number;
  freeShipping: FreeShippingProgress;
  minimumShortfall: number;
  currency: string;
  /** The payment method the surcharge was computed for (null = none chosen / no surcharge). */
  paymentMethod: string | null;
};

const quoteInputSchema = z.object({
  countryCode: z.string().trim().toUpperCase().max(2),
  shippingOptionId: z.string().trim().max(64).nullish(),
  insurance: z.boolean().optional(),
  /** Chosen Mollie method: only selects a surcharge rule; the amount is computed here. */
  paymentMethod: z.string().trim().toLowerCase().max(40).nullish(),
});

function optionView(o: ShippingOption): QuoteOptionView {
  return { id: o.zoneId, name: o.name, price: o.price, basePrice: o.basePrice, freeShipping: o.freeShipping, isPickup: o.isPickup, insurance: o.insurance };
}

function reasonText(q: QuoteResult): string | null {
  const detail = q.deliverable ? q.deliveryUnavailable : q.detail;
  switch (detail) {
    case null:
      return null;
    case "INVALID_COUNTRY":
      return "Choose a country";
    case "OVERWEIGHT":
      return "Your order is too heavy to ship to this country — contact us for a quote";
    default:
      return "We don't ship to this country";
  }
}

/** "Can't be shipped to Germany: Helmet M35, Dagger." */
export function restrictedMessage(countryCode: string, items: RestrictedItem[]): string {
  return `Can't be shipped to ${countryName(countryCode)} (local regulations): ${items.map((i) => i.title).join(", ")}. Remove ${items.length > 1 ? "them" : "it"} from your cart or choose pickup.`;
}

/** Cart items that compliance rules forbid shipping to `countryCode`. */
async function restrictedItemsFor(tenantId: string, lines: { productId: string; title: string }[], countryCode: string): Promise<RestrictedItem[]> {
  if (!lines.length || !isCountryCode(countryCode)) return [];
  const verdicts = await resolveCompliance(
    tenantId,
    lines.map((l) => l.productId),
    countryCode,
  );
  return lines.filter((l) => verdicts[l.productId]?.noShipping).map((l) => ({ productId: l.productId, title: l.title }));
}

function buildQuote(
  prices: number[],
  weightGrams: number,
  zones: Awaited<ReturnType<typeof loadQuoteZones>>,
  input: { countryCode: string; shippingOptionId?: string | null; insurance?: boolean },
  settings: { freeShippingThresholdCents: number; minimumOrderCents: number },
  currency: string,
  coupon: CouponOutcome | null = null,
  restrictedItems: RestrictedItem[] = [],
  surcharge: { method: string | null; rules: SurchargeRules } = { method: null, rules: {} },
): { quote: CheckoutQuote; option: ShippingOption | null } {
  const subtotal = prices.reduce((s, p) => s + p, 0);
  const result = calculateShippingQuote(zones, {
    countryCode: input.countryCode,
    totalWeightGrams: weightGrams,
    subtotal,
    freeShippingThreshold: settings.freeShippingThresholdCents || null,
  });
  // Compliance: items that may not be shipped there leave only pickup options.
  const restricted = restrictedItems.length > 0;
  const allowed = result.deliverable ? result.options.filter((o) => !restricted || o.isPickup) : [];
  // Default to the first (delivery) option; an unknown/stale id never falls back silently at placement.
  const picked = selectOption(result, input.shippingOptionId);
  const option = picked ? (allowed.includes(picked) ? picked : null) : input.shippingOptionId ? null : (allowed[0] ?? null);
  const insurance = Boolean(input.insurance && option?.insurance);
  const totals = applySurcharge(applyCouponToTotals(computeTotals(prices, option, insurance), coupon), surcharge.method, surcharge.rules);
  return {
    option,
    quote: {
      countryCode: input.countryCode,
      deliverable: result.deliverable,
      restrictedItems,
      unavailableReason: restricted ? restrictedMessage(input.countryCode, restrictedItems) : reasonText(result),
      options: allowed.map(optionView),
      selectedOptionId: option?.zoneId ?? null,
      insurance,
      totals,
      coupon: coupon ? (coupon.ok ? { code: coupon.code, ok: true, discount: coupon.discount, freeShipping: coupon.freeShipping } : { code: coupon.code, ok: false, message: coupon.message }) : null,
      itemCount: prices.length,
      freeShipping: freeShippingProgress(subtotal, settings.freeShippingThresholdCents),
      minimumShortfall: minimumOrderShortfall(subtotal, settings.minimumOrderCents),
      currency,
      paymentMethod: totals.surcharge > 0 ? surcharge.method : null,
    },
  };
}

/**
 * Server-side quote for the cart page estimate and the checkout summary. Uses the live prices of the
 * buyable cart lines (held or lapsed-but-free), the zone of `countryCode` and the surcharge rule of
 * `paymentMethod` (when given). Informational: placeOrder recomputes everything.
 */
export async function quoteCheckout(
  tenantId: string,
  token: string | null | undefined,
  input: z.input<typeof quoteInputSchema>,
  preloaded?: PreloadedCart,
): Promise<CheckoutQuote> {
  const data = quoteInputSchema.parse(input);
  const [cart, checkout, zones, rules] = await Promise.all([
    preloaded ? preloaded.cart : getCart(tenantId, token),
    getSettings(tenantId, "checkout"),
    requestQuoteZones(tenantId),
    data.paymentMethod ? getSurchargeRules(tenantId) : Promise.resolve({} as SurchargeRules),
  ]);
  const buyable = (cart?.lines ?? []).filter((l) => l.state === "held" || l.state === "lapsed");
  const currency = cart?.currency ?? (await getTenantCurrency(tenantId));
  const [coupon, restricted] = await Promise.all([
    cart?.couponCode && buyable.length
      ? evaluateCoupon(tenantId, cart.couponCode, { subtotal: cart.couponBase, shippingPrice: 0, email: cart.email }, (n) => formatMoney(n, currency))
      : null,
    restrictedItemsFor(tenantId, buyable, data.countryCode),
  ]);
  return buildQuote(
    buyable.map((l) => l.price),
    buyable.reduce((s, l) => s + l.weightGrams, 0),
    zones,
    data,
    checkout,
    currency,
    coupon,
    restricted,
    { method: data.paymentMethod ?? null, rules },
  ).quote;
}

// ─── Place order ────────────────────────────────────────────────────────────

export type PlaceOrderResult =
  | { ok: true; orderId: string; uuid: string; number: number; reused: boolean }
  | {
      ok: false;
      code: "INVALID" | "EMPTY" | "UNAVAILABLE" | "LOGIN_REQUIRED" | "NOT_CONFIGURED" | "MINIMUM" | "SHIPPING" | "COUPON" | "COMPLIANCE";
      message: string;
      errors?: FieldErrors;
      /** Product ids that block the order (taken by someone else / no longer for sale / not shippable there). */
      blockedProductIds?: string[];
    };

class Refusal extends Error {
  constructor(public readonly result: Extract<PlaceOrderResult, { ok: false }>) {
    super(result.message);
  }
}
const refuse = (r: Extract<PlaceOrderResult, { ok: false }>): never => {
  throw new Refusal(r);
};

async function findOrderByEvent(tx: Prisma.TransactionClient, tenantId: string, path: "idempotencyKey" | "cartId", value: string, sinceMs: number) {
  const ev = await tx.orderEvent.findFirst({
    where: { tenantId, type: "created", createdAt: { gte: new Date(Date.now() - sinceMs) }, data: { path: [path], equals: value } },
    orderBy: { createdAt: "desc" },
    select: { order: { select: { id: true, uuid: true, number: true, paymentStatus: true } } },
  });
  return ev?.order ?? null;
}

/**
 * Places the order for the cart behind `token`. Never trusts client prices/zone. Returns refusals as
 * `{ ok: false }` with field errors where applicable. Idempotent: a repeated submit (same
 * idempotencyKey, or an already emptied cart within 30 min) returns the existing order (`reused`).
 * The caller starts the Mollie payment afterwards (startOrderPayment) — outside this transaction.
 */
export async function placeOrder(
  tenantId: string,
  token: string | null | undefined,
  rawInput: unknown,
  viewer: ShopViewer | null,
): Promise<PlaceOrderResult> {
  const parsed = parseCheckoutInput(rawInput);
  if (!parsed.ok) return { ok: false, code: "INVALID", message: "Please check the highlighted fields", errors: parsed.errors };
  const input = parsed.data;

  const [checkout, legal, payment, zones, tenant, surchargeRules] = await Promise.all([
    getSettings(tenantId, "checkout"),
    getSettings(tenantId, "legal"),
    getPaymentSetup(tenantId),
    loadQuoteZones(tenantId),
    db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } }),
    getSurchargeRules(tenantId),
  ]);
  if (!payment.configured && !payment.devSimulation) {
    return { ok: false, code: "NOT_CONFIGURED", message: "Payments are not configured for this shop yet. Please contact us." };
  }
  const method = validatePaymentMethod(payment, input.paymentMethod);
  if (!method.ok) return { ok: false, code: "INVALID", message: method.message, errors: { paymentMethod: method.message } };
  if (!deliverableCountries(zones).includes(input.shipping.countryCode as CountryCode)) {
    return { ok: false, code: "SHIPPING", message: "We don't ship to this country", errors: { "shipping.countryCode": "We don't ship to this country" } };
  }
  const holdMinutes = Math.max(PAYMENT_HOLD_MINUTES, checkout.reservationMinutes);

  let result: PlaceOrderResult;
  try {
    result = await db.$transaction(
      async (tx) => {
        const cart = await lockCart(tx, tenantId, token);
        if (!cart) return refuse({ ok: false, code: "EMPTY", message: "Your cart is empty" });

        if (input.idempotencyKey) {
          const prev = await findOrderByEvent(tx, tenantId, "idempotencyKey", input.idempotencyKey, IDEMPOTENCY_WINDOW_MS);
          if (prev) return { ok: true as const, orderId: prev.id, uuid: prev.uuid, number: prev.number, reused: true };
        }
        const lines = await loadCartLinesTx(tenantId, cart.id, tx);
        if (lines.length === 0) {
          const prev = await findOrderByEvent(tx, tenantId, "cartId", cart.id, EMPTY_CART_REUSE_WINDOW_MS);
          if (prev && prev.paymentStatus === "PENDING") return { ok: true as const, orderId: prev.id, uuid: prev.uuid, number: prev.number, reused: true };
          return refuse({ ok: false, code: "EMPTY", message: "Your cart is empty" });
        }

        const req = requirementsFor(lines, viewer, checkout, legal);
        if (req.loginRequired) {
          refuse({
            ok: false,
            code: "LOGIN_REQUIRED",
            message: req.loginReason === "sensitive" ? "Your cart contains items that require an account. Please log in." : "Please log in to check out.",
          });
        }
        if (req.ageConfirmation && !input.ageConfirmed) {
          const msg = `Please confirm you are at least ${legal.minimumAge} years old`;
          refuse({ ok: false, code: "INVALID", message: msg, errors: { ageConfirmed: msg } });
        }

        // Lock the products (sorted → no deadlocks with other checkouts / finalizations), then make sure
        // THIS cart holds each one. reserveProduct returns our live hold, re-creates a lapsed one if the
        // product is still free, and throws CONFLICT when someone else holds it.
        const productIds = [...new Set(lines.map((l) => l.productId))].sort();
        const blocked: string[] = [];
        const products = new Map<string, { id: string; title: string; stockCode: number; sku: string | null; price: number; purchasePrice: number | null; weightGrams: number }>();
        for (const pid of productIds) {
          const rows = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM products WHERE id = ${pid} AND "tenantId" = ${tenantId} AND status = 'ACTIVE' AND quantity > 0 FOR UPDATE`;
          if (rows.length === 0) {
            blocked.push(pid);
            continue;
          }
          try {
            await reserveProduct({ tenantId, productId: pid, cartId: cart.id, minutes: checkout.reservationMinutes }, tx);
          } catch (err) {
            if (err instanceof ServiceError && (err.code === "CONFLICT" || err.code === "NOT_FOUND")) {
              blocked.push(pid);
              continue;
            }
            throw err;
          }
          const p = await tx.product.findUniqueOrThrow({
            where: { id: pid },
            select: { id: true, title: true, stockCode: true, sku: true, price: true, purchasePrice: true, weightGrams: true },
          });
          products.set(pid, p);
        }
        if (blocked.length) {
          const titles = lines.filter((l) => blocked.includes(l.productId)).map((l) => l.title);
          refuse({
            ok: false,
            code: "UNAVAILABLE",
            message: `No longer available: ${titles.join(", ")}. Remove ${titles.length > 1 ? "them" : "it"} from your cart to continue.`,
            blockedProductIds: blocked,
          });
        }

        // Money: from the locked rows only. A line bought through an accepted offer uses the agreed
        // price while the (locked) offer still applies; otherwise the list price.
        const offers = await lockApplicableOffersTx(tx, tenantId, lines);
        const ordered = lines.map((l) => {
          const p = products.get(l.productId)!;
          const offer = l.offerId ? offers.get(l.offerId) : undefined;
          return { ...p, unitPrice: offer ? offer.agreedAmount : p.price, offerId: offer?.id ?? null };
        });
        const prices = ordered.map((p) => p.unitPrice);
        const weight = ordered.reduce((s, p) => s + p.weightGrams, 0);
        const email = viewer ? viewer.email.toLowerCase() : input.email;

        // Coupon: re-evaluated under the coupon row lock (concurrent orders can't exceed maxRedemptions).
        let couponId: string | null = null;
        let coupon: CouponOutcome | null = null;
        if (cart.couponCode) {
          const couponBase = ordered.filter((p) => !p.offerId).reduce((s, p) => s + p.unitPrice, 0);
          const evaluated = await evaluateCouponForOrderTx(tx, tenantId, cart.couponCode, { subtotal: couponBase, shippingPrice: 0, email }, (n) => formatMoney(n, tenant.currency));
          if (!evaluated.outcome.ok) {
            const msg = `${evaluated.outcome.message} (${evaluated.outcome.code}). Remove the code in your cart to continue.`;
            refuse({ ok: false, code: "COUPON", message: msg, errors: { couponCode: evaluated.outcome.message } });
          }
          couponId = evaluated.couponId;
          coupon = evaluated.outcome;
        }

        // Compliance (per shipping country): NO_SHIPPING items only leave pickup.
        const restricted = await restrictedItemsFor(tenantId, lines, input.shipping.countryCode);
        const { option, quote } = buildQuote(
          prices,
          weight,
          zones,
          { countryCode: input.shipping.countryCode, shippingOptionId: input.shippingOptionId, insurance: input.insurance },
          checkout,
          tenant.currency,
          coupon,
          restricted,
          // Surcharge of the validated method only. The Mollie payment is then restricted to exactly this
          // method (startOrderPayment passes order.paymentMethod), so the customer can't switch to
          // another method on Mollie's page and skip — or wrongly pay — the surcharge.
          { method: method.method, rules: surchargeRules },
        );
        if (restricted.length && !option?.isPickup) {
          const msg = restrictedMessage(input.shipping.countryCode, restricted);
          refuse({
            ok: false,
            code: "COMPLIANCE",
            message: msg,
            errors: { "shipping.countryCode": msg },
            blockedProductIds: restricted.map((r) => r.productId),
          });
        }
        if (!option) {
          const msg = quote.deliverable ? "Choose one of the shipping options for your country" : (quote.unavailableReason ?? "We don't ship to this country");
          refuse({ ok: false, code: "SHIPPING", message: msg, errors: { shippingOptionId: msg } });
        }
        if (quote.minimumShortfall > 0) {
          refuse({ ok: false, code: "MINIMUM", message: `The minimum order amount is not reached yet` });
        }
        const totals = quote.totals;
        if (totals.total <= 0) refuse({ ok: false, code: "INVALID", message: "Your order total must be more than zero" });

        // Customer
        const name = `${input.shipping.firstName} ${input.shipping.lastName}`.trim();
        let customer = viewer?.customerId ? await tx.customer.findFirst({ where: { id: viewer.customerId, tenantId } }) : null;
        if (!customer) {
          customer = await findOrCreateGuestCustomer(tx, tenantId, { email, name, phone: input.phone });
          if (viewer && !customer.userId) {
            customer = await tx.customer.update({ where: { id: customer.id }, data: { userId: viewer.userId } });
          }
        }

        const number = await nextSequenceValue(tx, tenantId, "order.number");
        const covers = await tx.productImage.findMany({
          where: { tenantId, productId: { in: productIds } },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { productId: true, storageKey: true },
        });
        const coverOf = new Map<string, string>();
        for (const c of covers) if (!coverOf.has(c.productId)) coverOf.set(c.productId, variantKey(c.storageKey, "thumb"));

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

        const order = await tx.order.create({
          data: {
            tenantId,
            number,
            customerId: customer.id,
            email,
            customerName: name,
            phone: input.phone,
            currency: tenant.currency,
            subtotal: totals.subtotal,
            shippingTotal: totals.shippingTotal,
            surchargeTotal: totals.surcharge,
            surchargeLabel: totals.surchargeLabel,
            surchargeDetail: totals.surchargeSnapshot ?? undefined,
            discountTotal: totals.discount,
            couponCode: coupon?.ok ? coupon.code : null,
            offerId: ordered.find((p) => p.offerId)?.offerId ?? null,
            total: totals.total,
            paymentStatus: "PENDING",
            paymentMethod: method.method,
            shippingMethod: option!.isPickup ? "PICKUP" : "SHIP",
            shippingZoneId: option!.zoneId,
            shippingZoneName: option!.name,
            shippingWeightGrams: weight,
            customerNote: input.customerNote,
            lines: {
              create: ordered.map((p, i) => ({
                tenantId,
                productId: p.id,
                title: p.title,
                stockCode: p.stockCode,
                sku: p.sku,
                imagePath: coverOf.get(p.id) ?? null,
                unitPrice: p.unitPrice,
                quantity: 1,
                lineTotal: p.unitPrice,
                purchasePriceSnapshot: p.purchasePrice,
                sortOrder: i,
              })),
            },
            addresses: { create: [addr("SHIPPING", input.shipping), addr("BILLING", input.billing)] },
          },
          select: { id: true, uuid: true, number: true },
        });

        // Holds move from the cart to the order for the payment window (cartId cleared, so the cart
        // can never release them).
        const moved = await tx.$executeRaw`
          UPDATE reservations
          SET "orderId" = ${order.id}, "cartId" = NULL, "updatedAt" = now(),
              "expiresAt" = now() + make_interval(mins => ${holdMinutes}::int)
          WHERE "tenantId" = ${tenantId} AND "cartId" = ${cart.id} AND status = 'ACTIVE' AND "productId" = ANY(${productIds}::text[])`;
        if (moved !== productIds.length) throw new Error(`Reservation hand-over mismatch (${moved}/${productIds.length})`);

        const usedOffers = ordered.map((p) => p.offerId).filter((id): id is string => !!id);
        if (usedOffers.length) await convertOffersTx(tx, tenantId, usedOffers, order.id);
        if (couponId && coupon?.ok) {
          await tx.couponRedemption.create({
            data: { tenantId, couponId, orderId: order.id, email, amount: totals.discount + totals.shippingDiscount },
          });
        }

        await tx.cartItem.deleteMany({ where: { tenantId, cartId: cart.id } });
        await tx.cart.update({
          where: { id: cart.id },
          data: { countryCode: input.shipping.countryCode, customerId: cart.customerId ?? customer.id, couponCode: null },
        });
        await tx.orderEvent.create({
          data: {
            tenantId,
            orderId: order.id,
            type: "created",
            data: {
              source: "checkout",
              cartId: cart.id,
              idempotencyKey: input.idempotencyKey ?? null,
              termsAcceptedAt: new Date().toISOString(),
              ageConfirmed: req.ageConfirmation ? input.ageConfirmed : null,
              newsletterOptIn: input.newsletter,
              insurance: totals.insurance > 0,
              guest: !viewer,
              couponCode: coupon?.ok ? coupon.code : null,
              offerIds: usedOffers,
              surcharge: totals.surchargeSnapshot,
            },
          },
        });
        return { ok: true as const, orderId: order.id, uuid: order.uuid, number: order.number, reused: false };
      },
      { timeout: 20_000 },
    );
  } catch (err) {
    if (err instanceof Refusal) return err.result;
    throw err;
  }

  if (result.ok && !result.reused && input.newsletter) {
    // Best effort; the newsletter module sends its own double-opt-in mail.
    try {
      await subscribe(tenantId, viewer ? viewer.email : input.email, { source: "checkout" });
    } catch (err) {
      if (!(err instanceof ServiceError)) console.warn("[checkout] newsletter opt-in failed", err instanceof Error ? err.message : err);
    }
  }
  return result;
}

/** Re-export for the cart page (summary helper). */
export { summarize as summarizeCartLines };
