import { describe, expect, it } from "vitest";
import { applyCouponToTotals, evaluateCouponRule, percentOf, type CouponRule } from "./evaluate";
import { minimumOffer, offerPriceApplies, percentOfPrice } from "@/server/offers/rules";

const rule = (over: Partial<CouponRule> = {}): CouponRule => ({
  code: "X",
  type: "PERCENT",
  value: 1000,
  minSubtotal: 0,
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  perEmailLimit: 1,
  isActive: true,
  ...over,
});
const usage = { total: 0, byEmail: 0 };
const ev = (r: CouponRule | null, base: number, over: Partial<Parameters<typeof evaluateCouponRule>[1]> = {}) =>
  evaluateCouponRule(r, { code: "x", eligibleSubtotal: base, shippingPrice: 695, usage, ...over });

describe("coupon rules", () => {
  it("rounds percentages half-up", () => {
    expect(percentOf(999, 1250)).toBe(125); // 124.875
    expect(percentOf(1000, 1250)).toBe(125);
    expect(percentOf(5, 1000)).toBe(1); // 0.5 → 1
    expect(percentOf(4, 1000)).toBe(0); // 0.4 → 0
    expect(() => percentOf(-1, 10)).toThrow(RangeError);
  });

  it("caps FIXED at the eligible subtotal and handles FREE_SHIPPING", () => {
    expect(ev(rule({ type: "FIXED", value: 5000 }), 2000)).toMatchObject({ ok: true, discount: 2000 });
    expect(ev(rule({ type: "FREE_SHIPPING", value: 0 }), 2000)).toMatchObject({ ok: true, discount: 0, shippingDiscount: 695, freeShipping: true });
    expect(ev(rule({ type: "PERCENT", value: 10000 }), 2000)).toMatchObject({ ok: true, discount: 2000 });
  });

  it("refuses with a reason", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(ev(null, 100)).toMatchObject({ ok: false, reason: "NOT_FOUND" });
    expect(ev(rule({ isActive: false }), 100)).toMatchObject({ reason: "INACTIVE" });
    expect(ev(rule({ startsAt: new Date("2026-07-01") }), 100, { now })).toMatchObject({ reason: "NOT_STARTED" });
    expect(ev(rule({ endsAt: now }), 100, { now })).toMatchObject({ reason: "EXPIRED" });
    expect(ev(rule({ minSubtotal: 200 }), 100)).toMatchObject({ reason: "MIN_SUBTOTAL" });
    expect(ev(rule({ maxRedemptions: 2 }), 100, { usage: { total: 2, byEmail: 0 } })).toMatchObject({ reason: "MAX_REDEMPTIONS" });
    expect(ev(rule(), 100, { usage: { total: 1, byEmail: 1 } })).toMatchObject({ reason: "PER_EMAIL_LIMIT" });
    expect(ev(rule(), 100, { usage: { total: 1, byEmail: null } })).toMatchObject({ ok: true });
    expect(ev(rule({ perEmailLimit: null }), 100, { usage: { total: 9, byEmail: 9 } })).toMatchObject({ ok: true });
    expect(ev(rule(), 0)).toMatchObject({ reason: "NOT_APPLICABLE" });
  });

  it("applies to totals: total = subtotal − discount + shipping + insurance", () => {
    const t = { subtotal: 3000, shipping: 695, insurance: 250, shippingTotal: 945, total: 3945 };
    expect(applyCouponToTotals(t, null)).toEqual({ ...t, discount: 0, shippingDiscount: 0 });
    const pct = ev(rule({ value: 1000 }), 3000);
    expect(applyCouponToTotals(t, pct)).toMatchObject({ discount: 300, total: 3645 });
    const free = ev(rule({ type: "FREE_SHIPPING", value: 0 }), 3000);
    expect(applyCouponToTotals(t, free)).toMatchObject({ shipping: 0, shippingTotal: 250, shippingDiscount: 695, total: 3250 });
  });
});

describe("offer rules", () => {
  it("minimum offer, percentage and when the agreed price applies", () => {
    expect(minimumOffer(10001)).toBe(5001);
    expect(percentOfPrice(8000, 10000)).toBe(80);
    const now = new Date("2026-01-01T00:00:00Z");
    const offer = { tenantId: "t", productId: "p", status: "ACCEPTED", agreedAmount: 8000, checkoutExpiresAt: new Date("2026-01-02"), orderId: null };
    expect(offerPriceApplies(offer, { tenantId: "t", productId: "p" }, now)).toBe(true);
    expect(offerPriceApplies({ ...offer, orderId: "o" }, { tenantId: "t", productId: "p" }, now)).toBe(false);
    expect(offerPriceApplies(offer, { tenantId: "x", productId: "p" }, now)).toBe(false);
    expect(offerPriceApplies(offer, { tenantId: "t", productId: "q" }, now)).toBe(false);
    expect(offerPriceApplies({ ...offer, status: "CONVERTED" }, { tenantId: "t", productId: "p" }, now)).toBe(false);
    expect(offerPriceApplies({ ...offer, checkoutExpiresAt: now }, { tenantId: "t", productId: "p" }, now)).toBe(false);
  });
});
