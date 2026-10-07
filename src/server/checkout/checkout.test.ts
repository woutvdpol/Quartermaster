import { describe, expect, it } from "vitest";
import { formDataToObject, parseCheckoutInput } from "./schema";
import { computeTotals, deliverableCountries, freeShippingProgress, minimumOrderShortfall, selectOption } from "./totals";
import { orderDisplayState, shouldPoll } from "./status";
import { lineState, minutesUntil } from "@/server/cart/state";
import type { QuoteZone, ShippingOption } from "@/server/shipping/calc";

const addr = { firstName: "A", lastName: "B", street: "S 1", postalCode: "1000", city: "C", countryCode: "nl" };
const base = { email: "X@Y.test", phone: "+31 6 1234 5678", shipping: addr, billingSameAsShipping: "on", shippingOptionId: "z1", termsAccepted: "on" };

describe("checkout input", () => {
  it("parses a valid form and copies the shipping address to billing", () => {
    const r = parseCheckoutInput(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.email).toBe("x@y.test");
    expect(r.data.shipping.countryCode).toBe("NL");
    expect(r.data.billing).toEqual(r.data.shipping);
    expect(r.data.newsletter).toBe(false);
    expect("price" in r.data).toBe(false);
  });

  it("requires terms, a valid country and a postal code where countries use one", () => {
    const r = parseCheckoutInput({ ...base, termsAccepted: undefined, shipping: { ...addr, countryCode: "XX" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["shipping.countryCode", "termsAccepted"]);
    const noPc = parseCheckoutInput({ ...base, shipping: { ...addr, postalCode: "" } });
    expect(noPc.ok ? null : noPc.errors["shipping.postalCode"]).toBe("Enter your postal code");
    expect(parseCheckoutInput({ ...base, shipping: { ...addr, postalCode: "", countryCode: "IE" } }).ok).toBe(true);
  });

  it("validates a separate billing address with billing.* paths", () => {
    const r = parseCheckoutInput({ ...base, billingSameAsShipping: "", billing: { ...addr, city: "" } });
    expect(r.ok ? null : r.errors).toEqual({ "billing.city": "Enter your city" });
    const ok = parseCheckoutInput({ ...base, billingSameAsShipping: "", billing: { ...addr, countryCode: "be", city: "Gent" } });
    expect(ok.ok && ok.data.billing.countryCode).toBe("BE");
  });

  it("turns dotted FormData names into nested objects and ignores junk", () => {
    const fd = new FormData();
    fd.set("shipping.city", "Utrecht");
    fd.set("email", "a@b.test");
    fd.set("$ACTION_ID_123", "x");
    fd.set("__proto__.polluted", "1");
    fd.set("a.b.c.d.e", "deep");
    const o = formDataToObject(fd);
    expect(o).toMatchObject({ shipping: { city: "Utrecht" }, email: "a@b.test", a: { b: { c: "deep" } } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(o)).not.toContain("$ACTION_ID_123");
  });
});

const option = (over: Partial<ShippingOption> = {}): ShippingOption => ({
  zoneId: "z1",
  name: "NL",
  price: 695,
  basePrice: 695,
  isPickup: false,
  freeShipping: false,
  maxWeightGrams: 5000,
  insurance: { price: 250, maxInsuredValue: null },
  ...over,
});

describe("totals", () => {
  it("adds shipping and only offered insurance", () => {
    expect(computeTotals([1000, 2500], option(), false)).toEqual({ subtotal: 3500, shipping: 695, insurance: 0, shippingTotal: 695, total: 4195 });
    expect(computeTotals([1000], option(), true).total).toBe(1945);
    expect(computeTotals([1000], option({ insurance: null }), true).insurance).toBe(0);
    expect(computeTotals([1000], null, true).total).toBe(1000);
    expect(() => computeTotals([-1], option(), false)).toThrow(RangeError);
    expect(() => computeTotals([1.5], option(), false)).toThrow(RangeError);
  });

  it("free-shipping progress and minimum order", () => {
    expect(freeShippingProgress(1000, 0)).toBeNull();
    expect(freeShippingProgress(1000, 5000)).toEqual({ threshold: 5000, remaining: 4000, reached: false });
    expect(freeShippingProgress(6000, 5000)).toEqual({ threshold: 5000, remaining: 0, reached: true });
    expect(minimumOrderShortfall(1000, 0)).toBe(0);
    expect(minimumOrderShortfall(1000, 2500)).toBe(1500);
  });

  it("never falls back to another option than the one asked for", () => {
    const q = { deliverable: true as const, options: [option(), option({ zoneId: "p", isPickup: true, price: 0 })], deliveryUnavailable: null };
    expect(selectOption(q, "p")?.zoneId).toBe("p");
    expect(selectOption(q, "other")).toBeNull();
    expect(selectOption({ deliverable: false, reason: "NOT_DELIVERABLE", detail: "NO_ZONE" }, "z1")).toBeNull();
  });

  it("lists deliverable countries from zones", () => {
    const z = (over: Partial<QuoteZone>): QuoteZone => ({ id: "x", name: "x", countries: [], isPickup: false, isActive: true, sortOrder: 0, rates: [{ maxWeightGrams: 1, price: 1, insurancePrice: null, maxInsuredValue: null }], ...over });
    expect(deliverableCountries([z({ countries: ["NL", "BE"] }), z({ countries: ["DE"], rates: [] }), z({ countries: ["FR"], isActive: false })])).toEqual(["BE", "NL"]);
    expect(deliverableCountries([z({ countries: ["*"] })]).length).toBeGreaterThan(200);
    expect(deliverableCountries([z({ countries: ["NL"] }), z({ isPickup: true, countries: [], rates: [] })]).length).toBeGreaterThan(200);
    expect(deliverableCountries([])).toEqual([]);
  });
});

describe("cart line state", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const later = new Date("2026-01-01T12:10:00Z");
  it("classifies lines", () => {
    expect(lineState({ status: "SOLD", quantity: 0 }, null, "c", now)).toBe("unavailable");
    expect(lineState({ status: "ACTIVE", quantity: 0 }, null, "c", now)).toBe("unavailable");
    expect(lineState({ status: "ACTIVE", quantity: 1 }, null, "c", now)).toBe("lapsed");
    expect(lineState({ status: "ACTIVE", quantity: 1 }, { cartId: "c", expiresAt: now }, "c", now)).toBe("lapsed");
    expect(lineState({ status: "ACTIVE", quantity: 1 }, { cartId: "c", expiresAt: later }, "c", now)).toBe("held");
    expect(lineState({ status: "ACTIVE", quantity: 1 }, { cartId: "other", expiresAt: later }, "c", now)).toBe("taken");
    expect(lineState({ status: "ACTIVE", quantity: 1 }, { cartId: null, orderId: "o", expiresAt: later }, "c", now)).toBe("taken");
  });
  it("rounds minutes up, at least 1", () => {
    expect(minutesUntil(later, now)).toBe(10);
    expect(minutesUntil(new Date(now.getTime() + 61_000), now)).toBe(2);
    expect(minutesUntil(now, now)).toBe(1);
  });
});

describe("order display state", () => {
  const o = (paymentStatus: string, canceledAt: Date | null = null) => ({ paymentStatus, canceledAt });
  it("maps order + latest attempt", () => {
    expect(orderDisplayState(o("PAID"), { status: "PAID" })).toBe("paid");
    expect(orderDisplayState(o("PARTIALLY_REFUNDED"), null)).toBe("refunded");
    expect(orderDisplayState(o("CANCELED", new Date()), null)).toBe("canceled");
    expect(orderDisplayState(o("CANCELED"), { status: "CANCELED" })).toBe("failed");
    expect(orderDisplayState(o("EXPIRED"), null)).toBe("failed");
    expect(orderDisplayState(o("PENDING"), null)).toBe("unpaid");
    expect(orderDisplayState(o("PENDING"), { status: "OPEN" })).toBe("waiting");
    expect(orderDisplayState(o("PENDING"), { status: "PENDING" })).toBe("processing");
    expect(orderDisplayState(o("PENDING"), { status: "FAILED" })).toBe("unpaid");
    expect(shouldPoll("waiting")).toBe(true);
    expect(shouldPoll("paid")).toBe(false);
  });
});
