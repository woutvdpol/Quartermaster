import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { decrypt } from "@/server/auth/encryption";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { installHarness, linkIn, setSettings } from "../../../tests/integration/mail-harness";
import { makeProduct } from "@/server/orders/test-fixtures";
import { addToCart, getCart, removeFromCart } from "@/server/cart";
import { applyCartCoupon, removeCartCoupon, restoreCart, setCartContact } from "@/server/cart/extras";
import { findAbandonedCarts, sendAbandonedCartReminders } from "@/server/cart/abandoned";
import { createCoupon, listCoupons, listRedemptions, setCouponActive, updateCoupon } from "@/server/coupons";
import {
  acceptOffer,
  buyOffer,
  counterOffer,
  expireOffers,
  getCounterView,
  getOfferCheckoutView,
  listOffers,
  rejectOffer,
  respondToCounter,
  submitOffer,
} from "@/server/offers";
import { kpis } from "@/server/orders/metrics";
import { marginReport } from "@/server/purchasing";
import { placeOrder, quoteCheckout, simulateDevPayment } from "./index";
import type { ServiceContext } from "@/server/context";

let h: ReturnType<typeof installHarness>;
let ctx: ServiceContext;
let tenantId: string;
let nl: { id: string };

function input(over: Record<string, unknown> = {}) {
  return {
    email: "buyer@example.test",
    phone: "+31 6 12345678",
    shipping: { firstName: "Jan", lastName: "Jansen", street: "Damrak", houseNumber: "1", postalCode: "1012 LG", city: "Amsterdam", countryCode: "NL" },
    billingSameAsShipping: "on",
    shippingOptionId: nl.id,
    termsAccepted: "on",
    ...over,
  };
}

async function cartWith(...productIds: string[]) {
  let token: string | null = null;
  for (const pid of productIds) {
    const r = await addToCart(tenantId, token, pid);
    token = r.token ?? token;
    expect(r.result.ok).toBe(true);
  }
  return token!;
}

/** Token from the latest queued mail of `template` (decrypted). */
function mailToken(template: string): string {
  const job = [...h.jobs].reverse().find((j) => (j.data as { template: string }).template === template);
  if (!job) throw new Error(`no ${template} mail queued`);
  return decrypt((job.data as { props: { tokenEnc: string } }).props.tokenEnc);
}

beforeEach(async () => {
  await resetDb();
  h = installHarness();
  process.env.MAIL_FROM_FALLBACK = "no-reply@quartermaster.test";
  ctx = await createTenantContext();
  tenantId = ctx.tenantId;
  await setSettings(tenantId, "general", { shopName: "Concept", contactEmail: "owner@concept.test" });
  await db.tenantDomain.create({ data: { tenantId, host: "concept.test", isPrimary: true } });
  nl = await db.shippingZone.create({
    data: { tenantId, name: "Netherlands", countries: ["NL"], sortOrder: 0, rates: { create: [{ tenantId, maxWeightGrams: 5000, price: 695 }] } },
  });
});
afterEach(() => h.uninstall());

describe("coupons", () => {
  it("PERCENT rounds half-up to cents and reduces the total; the redemption is recorded atomically", async () => {
    await createCoupon(ctx, { code: "ten5", type: "PERCENT", value: 1250 }); // 12.5 %
    const p = await makeProduct(tenantId, { price: 999 });
    const token = await cartWith(p.id);
    expect(await applyCartCoupon(tenantId, token, " ten5 ")).toMatchObject({ ok: true });
    const q = await quoteCheckout(tenantId, token, { countryCode: "NL" });
    // 999 × 12.5 % = 124.875 → 125
    expect(q.totals).toMatchObject({ subtotal: 999, discount: 125, shipping: 695, total: 999 - 125 + 695 });
    expect(q.coupon).toMatchObject({ code: "TEN5", ok: true, discount: 125 });

    const res = await placeOrder(tenantId, token, input(), null);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order).toMatchObject({ subtotal: 999, discountTotal: 125, couponCode: "TEN5", shippingTotal: 695, total: 1569 });
    expect(await db.couponRedemption.findMany()).toMatchObject([{ orderId: order.id, email: "buyer@example.test", amount: 125 }]);
    expect((await db.cart.findFirstOrThrow()).couponCode).toBeNull();
  });

  it("FIXED never exceeds the subtotal; FREE_SHIPPING zeroes shipping", async () => {
    await createCoupon(ctx, { code: "BIG", type: "FIXED", value: 50000 });
    await createCoupon(ctx, { code: "SHIPFREE", type: "FREE_SHIPPING" });
    const p = await makeProduct(tenantId, { price: 2000 });
    const token = await cartWith(p.id);
    await applyCartCoupon(tenantId, token, "BIG");
    expect((await quoteCheckout(tenantId, token, { countryCode: "NL" })).totals).toMatchObject({ subtotal: 2000, discount: 2000, total: 695 });

    await applyCartCoupon(tenantId, token, "shipfree");
    const q = await quoteCheckout(tenantId, token, { countryCode: "NL" });
    expect(q.totals).toMatchObject({ subtotal: 2000, discount: 0, shipping: 0, shippingDiscount: 695, total: 2000 });
    const res = await placeOrder(tenantId, token, input(), null);
    if (!res.ok) throw new Error(res.message);
    expect(await db.order.findUniqueOrThrow({ where: { id: res.orderId } })).toMatchObject({ shippingTotal: 0, discountTotal: 0, couponCode: "SHIPFREE", total: 2000 });
    expect((await db.couponRedemption.findFirstOrThrow()).amount).toBe(695);
  });

  it("refuses inactive, not started, expired, min subtotal, per-email and unknown codes", async () => {
    const p = await makeProduct(tenantId, { price: 3000 });
    const token = await cartWith(p.id);
    const day = 86_400_000;
    await createCoupon(ctx, { code: "OFF", type: "FIXED", value: 100, isActive: false });
    await createCoupon(ctx, { code: "SOON", type: "FIXED", value: 100, startsAt: new Date(Date.now() + day) });
    await createCoupon(ctx, { code: "OLD", type: "FIXED", value: 100, startsAt: new Date(Date.now() - 2 * day), endsAt: new Date(Date.now() - day) });
    await createCoupon(ctx, { code: "MIN", type: "FIXED", value: 100, minSubtotal: 5000 });
    expect(await applyCartCoupon(tenantId, token, "OFF")).toEqual({ ok: false, message: "This code is no longer active" });
    expect(await applyCartCoupon(tenantId, token, "SOON")).toEqual({ ok: false, message: "This code is not valid yet" });
    expect(await applyCartCoupon(tenantId, token, "OLD")).toEqual({ ok: false, message: "This code has expired" });
    expect(await applyCartCoupon(tenantId, token, "MIN")).toEqual({ ok: false, message: "This code needs a subtotal of at least €50.00" });
    expect(await applyCartCoupon(tenantId, token, "NOPE")).toEqual({ ok: false, message: "This code is not valid" });
    expect((await getCart(tenantId, token))!.couponCode).toBeNull();

    // per-email limit (default 1): second order by the same email is refused at placement
    await createCoupon(ctx, { code: "ONCE", type: "FIXED", value: 100 });
    await applyCartCoupon(tenantId, token, "ONCE");
    expect((await placeOrder(tenantId, token, input(), null)).ok).toBe(true);
    const p2 = await makeProduct(tenantId, { price: 3000 });
    const t2 = await cartWith(p2.id);
    expect(await applyCartCoupon(tenantId, t2, "ONCE")).toMatchObject({ ok: true }); // email unknown yet
    const again = await placeOrder(tenantId, t2, input(), null);
    expect(again).toMatchObject({ ok: false, code: "COUPON", errors: { couponCode: "You have already used this code" } });
    expect(await db.order.count()).toBe(1);
    // the quote shows it once the email is known
    await setCartContact(tenantId, t2, { email: "buyer@example.test" });
    expect((await quoteCheckout(tenantId, t2, { countryCode: "NL" })).coupon).toMatchObject({ ok: false, message: "You have already used this code" });
    await removeCartCoupon(tenantId, t2);
    expect((await placeOrder(tenantId, t2, input(), null)).ok).toBe(true);
  });

  it("maxRedemptions holds under concurrent checkouts", async () => {
    await createCoupon(ctx, { code: "FIRST", type: "PERCENT", value: 1000, maxRedemptions: 1, perEmailLimit: null });
    const tokens: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = await makeProduct(tenantId, { price: 5000 });
      const t = await cartWith(p.id);
      await applyCartCoupon(tenantId, t, "FIRST");
      tokens.push(t);
    }
    const results = await Promise.all(tokens.map((t, i) => placeOrder(tenantId, t, input({ email: `b${i}@example.test` }), null)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "COUPON")).toHaveLength(3);
    expect(await db.couponRedemption.count()).toBe(1);
    const list = await listCoupons(ctx);
    expect(list.rows[0]).toMatchObject({ code: "FIRST", used: 1, redemptions: 1, discountGiven: 500 });
    expect((await listRedemptions(ctx, list.rows[0].id)).rows).toHaveLength(1);
  });

  it("a dead order frees its slot only after the retry window; admin rules", async () => {
    const c = await createCoupon(ctx, { code: "SLOT", type: "FIXED", value: 100, maxRedemptions: 1, perEmailLimit: null });
    const p = await makeProduct(tenantId);
    const t = await cartWith(p.id);
    await applyCartCoupon(tenantId, t, "SLOT");
    const placed = await placeOrder(tenantId, t, input(), null);
    if (!placed.ok) throw new Error(placed.message);
    await simulateDevPayment(tenantId, placed.uuid, "failed");
    expect((await listCoupons(ctx)).rows[0].used).toBe(1);
    await db.order.update({ where: { id: placed.orderId }, data: { placedAt: new Date(Date.now() - 73 * 3600_000) } });
    expect((await listCoupons(ctx)).rows[0]).toMatchObject({ used: 0, redemptions: 1 });

    await expect(updateCoupon(ctx, c.id, { code: "OTHER", type: "FIXED", value: 100 })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createCoupon(ctx, { code: "slot", type: "FIXED", value: 1 })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createCoupon(ctx, { code: "PCT", type: "PERCENT", value: 20000 })).rejects.toMatchObject({ code: "INVALID" });
    await setCouponActive(ctx, c.id, false);
    expect((await listCoupons(ctx, { view: "inactive" })).rows).toHaveLength(1);
  });

  it("the database refuses a discount above the subtotal", async () => {
    const p = await makeProduct(tenantId);
    const t = await cartWith(p.id);
    const placed = await placeOrder(tenantId, t, input(), null);
    if (!placed.ok) throw new Error(placed.message);
    await expect(db.order.update({ where: { id: placed.orderId }, data: { discountTotal: 10001 } })).rejects.toThrow();
    await expect(db.order.update({ where: { id: placed.orderId }, data: { discountTotal: -1 } })).rejects.toThrow();
  });
});

describe("offers", () => {
  async function offerProduct(price = 10000) {
    const p = await makeProduct(tenantId, { price, title: "M40 helmet" });
    return db.product.update({ where: { id: p.id }, data: { acceptsOffers: true } });
  }
  const offerInput = (productId: string, over: Record<string, unknown> = {}) => ({ productId, email: "Collector@Example.test", name: "Piet", amount: 8000, message: "Cash ready", ...over });

  it("submit: validation, honeypot, one open offer per email, mails to owner and customer", async () => {
    const p = await offerProduct();
    const plain = await makeProduct(tenantId);
    expect(await submitOffer(tenantId, offerInput(plain.id))).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    await setSettings(tenantId, "catalog", { allowOffersDefault: true });
    expect(await submitOffer(tenantId, offerInput(plain.id, { amount: 4999 }))).toMatchObject({ ok: false, code: "INVALID", errors: { amount: expect.stringContaining("lowest") } });
    expect(await submitOffer(tenantId, offerInput(p.id, { amount: 10000 }))).toMatchObject({ ok: false, code: "INVALID" });
    expect(await submitOffer(tenantId, offerInput(p.id, { website: "http://spam" }))).toEqual({ ok: true, offerId: null });
    expect(await db.offer.count()).toBe(0);

    const ok = await submitOffer(tenantId, offerInput(p.id), { ip: "1.2.3.4" });
    expect(ok).toMatchObject({ ok: true, offerId: expect.any(String) });
    expect(await submitOffer(tenantId, offerInput(p.id, { amount: 8500 }), { ip: "1.2.3.4" })).toMatchObject({ ok: false, code: "DUPLICATE" });
    expect(await db.offer.findFirstOrThrow()).toMatchObject({ email: "collector@example.test", amount: 8000, status: "PENDING", currency: "EUR" });

    await h.drain();
    expect(h.mails.map((m) => m.to)).toEqual(["owner@concept.test", "collector@example.test"]);
    expect(String(h.mails[0].subject)).toContain("New offer");
    expect(String(h.mails[0].html)).toContain("80% of price");
  });

  it("rate limits per email", async () => {
    await setSettings(tenantId, "catalog", { allowOffersDefault: true });
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await submitOffer(tenantId, offerInput((await makeProduct(tenantId)).id), { ip: `10.0.0.${i}` }));
    expect(results.slice(0, 5).every((r) => r.ok)).toBe(true);
    expect(results[5]).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("accept → personal link → buy now at the agreed price; coupons skip the offer line; CONVERTED on placement", async () => {
    const p = await offerProduct(10000);
    const other = await makeProduct(tenantId, { price: 4000 });
    const sub = await submitOffer(tenantId, offerInput(p.id));
    if (!sub.ok || !sub.offerId) throw new Error("submit failed");
    await acceptOffer(ctx, sub.offerId, { note: "Deal!" });
    const token = mailToken("offer-accepted");
    await h.drain();
    const accepted = h.mails.find((m) => String(m.subject).includes("accepted"))!;
    expect(linkIn(accepted, "/offer/").pathname).toBe(`/offer/${token}`);

    expect(await getOfferCheckoutView(tenantId, token)).toMatchObject({ state: "ready", agreedAmount: 8000, product: { listPrice: 10000 } });
    expect(await getOfferCheckoutView((await createTenantContext()).tenantId, token)).toBeNull();

    const bought = await buyOffer(tenantId, token, null, null);
    expect(bought.result.ok).toBe(true);
    const cartToken = bought.token!;
    expect((await addToCart(tenantId, cartToken, other.id)).result.ok).toBe(true);
    const cart = (await getCart(tenantId, cartToken))!;
    expect(cart.lines.find((l) => l.productId === p.id)).toMatchObject({ price: 8000, listPrice: 10000, offerApplied: true });
    expect(cart).toMatchObject({ subtotal: 12000, couponBase: 4000 });

    await createCoupon(ctx, { code: "TEN", type: "PERCENT", value: 1000 });
    await applyCartCoupon(tenantId, cartToken, "TEN");
    const res = await placeOrder(tenantId, cartToken, input(), null);
    if (!res.ok) throw new Error(res.message);
    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { lines: true } });
    expect(order).toMatchObject({ subtotal: 12000, discountTotal: 400, offerId: sub.offerId, total: 12000 - 400 + 695 });
    expect(order.lines.find((l) => l.productId === p.id)).toMatchObject({ unitPrice: 8000, lineTotal: 8000 });
    expect(await db.offer.findUniqueOrThrow({ where: { id: sub.offerId } })).toMatchObject({ status: "CONVERTED", orderId: order.id });
    expect(await getOfferCheckoutView(tenantId, token)).toMatchObject({ state: "used" });
    expect((await buyOffer(tenantId, token, null, null)).result).toMatchObject({ ok: false, code: "OFFER_INVALID" });

    // Payment fails → the cron reverts the offer so the customer can still buy at the agreed price.
    await simulateDevPayment(tenantId, res.uuid, "expired");
    expect(await expireOffers()).toMatchObject({ reverted: 1 });
    expect(await db.offer.findUniqueOrThrow({ where: { id: sub.offerId } })).toMatchObject({ status: "ACCEPTED", orderId: null });
    expect(await getOfferCheckoutView(tenantId, token)).toMatchObject({ state: "ready" });
  });

  it("an expired link falls back to the list price everywhere", async () => {
    const p = await offerProduct(10000);
    const sub = await submitOffer(tenantId, offerInput(p.id));
    if (!sub.ok || !sub.offerId) throw new Error("submit failed");
    await acceptOffer(ctx, sub.offerId);
    const token = mailToken("offer-accepted");
    const bought = await buyOffer(tenantId, token, null, null);
    await db.offer.update({ where: { id: sub.offerId }, data: { checkoutExpiresAt: new Date(Date.now() - 1000) } });
    const cart = (await getCart(tenantId, bought.token))!;
    expect(cart.lines[0]).toMatchObject({ price: 10000, offerApplied: false, offerExpired: true });
    const res = await placeOrder(tenantId, bought.token, input(), null);
    if (!res.ok) throw new Error(res.message);
    expect(await db.order.findUniqueOrThrow({ where: { id: res.orderId } })).toMatchObject({ subtotal: 10000, offerId: null });
    expect((await db.offer.findUniqueOrThrow({ where: { id: sub.offerId } })).status).toBe("ACCEPTED");
    expect(await expireOffers()).toMatchObject({ expired: 1 });
    expect(await getOfferCheckoutView(tenantId, token)).toMatchObject({ state: "expired" });
  });

  it("counter → customer accepts via link (new checkout link) / declines; reject; pending expiry", async () => {
    const p = await offerProduct(10000);
    const sub = await submitOffer(tenantId, offerInput(p.id));
    if (!sub.ok || !sub.offerId) throw new Error("submit failed");
    await expect(counterOffer(ctx, sub.offerId, { counterAmount: 7000 })).rejects.toMatchObject({ code: "INVALID" });
    await expect(counterOffer(ctx, sub.offerId, { counterAmount: 12000 })).rejects.toMatchObject({ code: "INVALID" });
    await counterOffer(ctx, sub.offerId, { counterAmount: 9000, note: "Best I can do" });
    const counterToken = mailToken("offer-countered");
    expect(await getCounterView(tenantId, counterToken)).toMatchObject({ state: "open", amount: 8000, counterAmount: 9000, note: "Best I can do" });
    const r = await respondToCounter(tenantId, counterToken, "accept");
    expect(r).toMatchObject({ ok: true, decision: "accept" });
    if (!r.ok || r.decision !== "accept") return;
    expect(await respondToCounter(tenantId, counterToken, "accept")).toMatchObject({ ok: false });
    expect(await db.offer.findUniqueOrThrow({ where: { id: sub.offerId } })).toMatchObject({ status: "ACCEPTED", agreedAmount: 9000 });
    expect(await getOfferCheckoutView(tenantId, r.checkoutToken)).toMatchObject({ state: "ready", agreedAmount: 9000 });
    expect(mailToken("offer-accepted")).toBe(r.checkoutToken);

    // decline
    const p2 = await offerProduct(10000);
    const s2 = await submitOffer(tenantId, offerInput(p2.id));
    if (!s2.ok || !s2.offerId) throw new Error("submit failed");
    await counterOffer(ctx, s2.offerId, { counterAmount: 9500 });
    expect(await respondToCounter(tenantId, mailToken("offer-countered"), "decline")).toMatchObject({ ok: true, decision: "decline" });
    expect((await db.offer.findUniqueOrThrow({ where: { id: s2.offerId } })).status).toBe("WITHDRAWN");

    // reject + expire
    const p3 = await offerProduct(10000);
    const s3 = await submitOffer(tenantId, offerInput(p3.id));
    const p4 = await offerProduct(10000);
    const s4 = await submitOffer(tenantId, offerInput(p4.id));
    if (!s3.ok || !s3.offerId || !s4.ok || !s4.offerId) throw new Error("submit failed");
    await rejectOffer(ctx, s3.offerId, { note: "Sorry" });
    await expect(acceptOffer(ctx, s3.offerId)).rejects.toMatchObject({ code: "CONFLICT" });
    await db.offer.update({ where: { id: s4.offerId }, data: { createdAt: new Date(Date.now() - 73 * 3600_000) } });
    expect((await expireOffers()).expired).toBe(1);
    const list = await listOffers(ctx, { view: "closed" });
    expect(list.rows.map((o) => o.status).sort()).toEqual(["EXPIRED", "REJECTED", "WITHDRAWN"]);
    expect(list.counts).toMatchObject({ pending: 0, accepted: 1, closed: 3, all: 4 });
    await h.drain();
    expect(h.mails.some((m) => String(m.subject).includes("About your offer"))).toBe(true);
  });
});

describe("abandoned cart", () => {
  async function age(cartId: string, hours: number) {
    await db.$executeRaw`UPDATE carts SET "updatedAt" = now() - make_interval(hours => ${hours}::int), "createdAt" = now() - make_interval(hours => ${hours + 1}::int) WHERE id = ${cartId}`;
  }

  it("only consenting, idle (2–24 h), unordered carts get one reminder; the link restores the cart", async () => {
    const a = await makeProduct(tenantId, { title: "Mess tin" });
    const b = await makeProduct(tenantId);
    const c = await makeProduct(tenantId);
    const tA = await cartWith(a.id);
    const tB = await cartWith(b.id);
    const tC = await cartWith(c.id);
    await setCartContact(tenantId, tA, { email: "a@example.test", reminderConsent: true });
    await setCartContact(tenantId, tB, { email: "b@example.test" }); // no consent
    await setCartContact(tenantId, tC, { email: "c@example.test", reminderConsent: true });
    const [cA, cB, cC] = await Promise.all([tA, tB, tC].map(async (t) => (await getCart(tenantId, t))!.id));
    await age(cA, 3);
    await age(cB, 3);
    await age(cC, 30); // too old

    expect((await findAbandonedCarts()).map((x) => x.id)).toEqual([cA]);
    expect(await sendAbandonedCartReminders()).toEqual({ queued: 1 });
    expect(await sendAbandonedCartReminders()).toEqual({ queued: 0 }); // one mail per cart
    await h.drain();
    expect(h.mails).toHaveLength(1);
    expect(h.mails[0].to).toBe("a@example.test");
    expect(String(h.mails[0].html)).toContain("Mess tin");
    const link = linkIn(h.mails[0], "/cart?restore=");
    const restoreToken = link.searchParams.get("restore")!;

    const restored = await restoreCart(tenantId, restoreToken);
    expect(restored).toMatchObject({ cartId: cA });
    expect(await getCart(tenantId, tA)).toBeNull(); // old cookie rotated out
    expect((await getCart(tenantId, restored!.token))!.lines.map((l) => l.productId)).toEqual([a.id]);
    expect(await restoreCart(tenantId, restoreToken.slice(0, -2) + "xx")).toBeNull();
    expect(await restoreCart((await createTenantContext()).tenantId, restoreToken)).toBeNull();
  });

  it("skips carts that were ordered, emptied, or whose consent was withdrawn", async () => {
    const a = await makeProduct(tenantId);
    const b = await makeProduct(tenantId);
    const tA = await cartWith(a.id);
    const tB = await cartWith(b.id);
    await setCartContact(tenantId, tA, { email: "a@example.test", reminderConsent: true });
    await setCartContact(tenantId, tB, { email: "b@example.test", reminderConsent: true });
    await setCartContact(tenantId, tB, { reminderConsent: false });
    await removeFromCart(tenantId, tA, a.id);
    for (const t of [tA, tB]) await age((await getCart(tenantId, t))!.id, 3);
    expect(await findAbandonedCarts()).toEqual([]);
  });
});

describe("revenue with discounts", () => {
  it("dashboard revenue and margin report use subtotal − discount", async () => {
    await createCoupon(ctx, { code: "HALF", type: "PERCENT", value: 5000 });
    const p = await makeProduct(tenantId, { price: 10000, purchasePrice: 4000 });
    const t = await cartWith(p.id);
    await applyCartCoupon(tenantId, t, "HALF");
    const placed = await placeOrder(tenantId, t, input(), null);
    if (!placed.ok) throw new Error(placed.message);
    await simulateDevPayment(tenantId, placed.uuid, "paid");
    const k = await kpis(ctx, { days: 7 });
    expect(k.revenue.value).toBe(5000);
    expect(k.marginPct.value).toBe(20); // (5000 − 4000) / 5000
    const m = await marginReport(ctx, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000), groupBy: "month" });
    expect(m.totals).toMatchObject({ revenue: 5000, cost: 4000, margin: 1000 });
  });
});
