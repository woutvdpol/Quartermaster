import { describe, expect, it } from "vitest";
import {
  applySurcharge,
  computeSurcharge,
  describeSurchargeRule,
  formatBps,
  isActiveRule,
  parsePercentToBps,
  surchargeBase,
  surchargeLabelFor,
  surchargeRulesSchema,
  type SurchargeRule,
} from "./surcharge";
import { parseStoredPaymentsSettings } from "./settings";

const rule = (over: Partial<SurchargeRule> = {}): SurchargeRule => ({ percentBps: 500, fixed: 0, cap: null, label: "PayPal fee", ...over });
const eur = (n: number) => `€${(n / 100).toFixed(2)}`;

describe("computeSurcharge", () => {
  it("applies the percentage with half-up rounding to whole cents", () => {
    expect(computeSurcharge(rule(), 10000)).toBe(500);
    expect(computeSurcharge(rule(), 10010)).toBe(501); // 500.5 → 501 (half up)
    expect(computeSurcharge(rule(), 10009)).toBe(500); // 500.45 → 500
    expect(computeSurcharge(rule({ percentBps: 250 }), 1990)).toBe(50); // 49.75 → 50
    expect(computeSurcharge(rule({ percentBps: 1 }), 4999)).toBe(0); // 0.4999 → 0
    expect(computeSurcharge(rule({ percentBps: 1 }), 5000)).toBe(1); // 0.5 → 1
  });

  it("adds a fixed amount and respects the cap", () => {
    expect(computeSurcharge(rule({ percentBps: 290, fixed: 35 }), 10000)).toBe(325);
    expect(computeSurcharge(rule({ percentBps: 0, fixed: 50 }), 10000)).toBe(50);
    expect(computeSurcharge(rule({ cap: 1000 }), 1_000_000)).toBe(1000);
    expect(computeSurcharge(rule({ fixed: 500, cap: 300 }), 100)).toBe(300);
  });

  it("is 0 without a usable rule or base", () => {
    expect(computeSurcharge(null, 10000)).toBe(0);
    expect(computeSurcharge(rule({ percentBps: 0 }), 10000)).toBe(0);
    expect(computeSurcharge(rule({ cap: 0 }), 10000)).toBe(0);
    expect(computeSurcharge(rule(), 0)).toBe(0);
    expect(computeSurcharge(rule({ fixed: 100 }), -5)).toBe(0);
    expect(isActiveRule(rule({ percentBps: 0, fixed: 0 }))).toBe(false);
  });

  it("stays exact for large amounts (no float drift)", () => {
    expect(computeSurcharge(rule({ percentBps: 2000 }), 123_456_789)).toBe(24_691_358); // 24 691 357.8 → …358
  });
});

describe("applySurcharge", () => {
  const totals = { subtotal: 20000, discount: 2000, shipping: 695, insurance: 250, shippingTotal: 945, total: 18945, shippingDiscount: 0 };

  it("charges on subtotal − discount + shippingTotal and adds it to the total", () => {
    expect(surchargeBase(totals)).toBe(18945);
    const t = applySurcharge(totals, "paypal", { paypal: rule() });
    expect(t.surcharge).toBe(947); // 947.25
    expect(t.total).toBe(18945 + 947);
    expect(t.surchargeLabel).toBe("PayPal fee");
    expect(t.surchargeSnapshot).toEqual({ method: "paypal", label: "PayPal fee", percentBps: 500, fixed: 0, cap: null, base: 18945, amount: 947, rounding: "half-up" });
  });

  it("leaves totals alone for methods without a rule or without a method", () => {
    for (const m of ["ideal", null, undefined, ""]) {
      const t = applySurcharge(totals, m, { paypal: rule() });
      expect(t).toMatchObject({ total: 18945, surcharge: 0, surchargeLabel: null, surchargeSnapshot: null });
    }
  });
});

describe("rules: parsing and display", () => {
  it("parses percentages to basis points", () => {
    expect(parsePercentToBps("5")).toBe(500);
    expect(parsePercentToBps("2,5")).toBe(250);
    expect(parsePercentToBps("2.75 %")).toBe(275);
    expect(parsePercentToBps("")).toBe(0);
    expect(parsePercentToBps("1.234")).toBeNull();
    expect(parsePercentToBps("-1")).toBeNull();
    expect(parsePercentToBps("abc")).toBeNull();
    expect(formatBps(500)).toBe("5");
    expect(formatBps(250)).toBe("2.5");
    expect(formatBps(125)).toBe("1.25");
  });

  it("describes a rule", () => {
    expect(describeSurchargeRule(rule(), eur)).toBe("5%");
    expect(describeSurchargeRule(rule({ percentBps: 290, fixed: 35 }), eur)).toBe("2.9% + €0.35");
    expect(describeSurchargeRule(rule({ percentBps: 0, fixed: 50, cap: 40 }), eur)).toBe("€0.50 (max €0.40)");
  });

  it("validates rules: max 20%, method ids, label required", () => {
    expect(surchargeRulesSchema.safeParse({ paypal: rule({ percentBps: 2000 }) }).success).toBe(true);
    expect(surchargeRulesSchema.safeParse({ paypal: rule({ percentBps: 2001 }) }).success).toBe(false);
    expect(surchargeRulesSchema.safeParse({ "pay pal": rule() }).success).toBe(false);
    expect(surchargeRulesSchema.safeParse({ paypal: rule({ label: " " }) }).success).toBe(false);
    expect(surchargeRulesSchema.safeParse({ paypal: rule({ fixed: -1 }) }).success).toBe(false);
  });

  it("invalid stored surcharges never break the Mollie part of the payments row", () => {
    const parsed = parseStoredPaymentsSettings({ mollie: { apiKeyEncrypted: "v1.x", mode: "live", keyHint: "abcd" }, surcharges: { paypal: { percentBps: 99999 } } });
    expect(parsed.mollie.apiKeyEncrypted).toBe("v1.x");
    expect(parsed.surcharges).toEqual({});
    expect(parseStoredPaymentsSettings({}).surcharges).toEqual({});
  });

  it("falls back to a generic label for orders without a snapshot", () => {
    expect(surchargeLabelFor({ surchargeLabel: null })).toBe("Payment surcharge");
    expect(surchargeLabelFor({ surchargeLabel: "PayPal fee" })).toBe("PayPal fee");
  });
});
