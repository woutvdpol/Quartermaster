import { describe, expect, it } from "vitest";
import { calculateShippingQuote, findDeliveryZone, findTier, type QuoteRate, type QuoteZone } from "./calc";

const rate = (maxWeightGrams: number, price: number, insurance?: { price: number; max?: number }): QuoteRate => ({
  maxWeightGrams,
  price,
  insurancePrice: insurance?.price ?? null,
  maxInsuredValue: insurance?.max ?? null,
});

let n = 0;
const zone = (p: Partial<QuoteZone> & Pick<QuoteZone, "countries">): QuoteZone => ({
  id: `z${++n}`,
  name: p.name ?? `Zone ${n}`,
  isPickup: false,
  isActive: true,
  sortOrder: n,
  rates: [rate(1000, 500), rate(5000, 900), rate(20000, 1500)],
  ...p,
});

const nl = zone({ name: "Netherlands", countries: ["NL"], rates: [rate(5000, 900), rate(1000, 500, { price: 250, max: 50000 })] });
const eu = zone({ name: "EU", countries: ["BE", "DE", "FR"] });
const world = zone({ name: "World", countries: ["*"], rates: [rate(2000, 2500)] });
const pickup = zone({ name: "Pickup in store", countries: [], isPickup: true, rates: [] });

const q = (zones: QuoteZone[], countryCode: string, totalWeightGrams: number, extra: Partial<Parameters<typeof calculateShippingQuote>[1]> = {}) =>
  calculateShippingQuote(zones, { countryCode, totalWeightGrams, subtotal: 10000, ...extra });

describe("findTier", () => {
  const rates = [rate(5000, 900), rate(1000, 500), rate(20000, 1500)];
  it("picks the first tier whose max ≥ weight, regardless of input order", () => {
    expect(findTier(rates, 0)?.price).toBe(500);
    expect(findTier(rates, 1)?.price).toBe(500);
    expect(findTier(rates, 1000)?.price).toBe(500); // boundary is inclusive
    expect(findTier(rates, 1001)?.price).toBe(900);
    expect(findTier(rates, 5000)?.price).toBe(900);
    expect(findTier(rates, 20000)?.price).toBe(1500);
  });
  it("returns null when overweight or without rates", () => {
    expect(findTier(rates, 20001)).toBeNull();
    expect(findTier([], 1)).toBeNull();
  });
});

describe("findDeliveryZone", () => {
  it("prefers an explicit country zone over rest of world", () => {
    expect(findDeliveryZone([world, nl, eu], "NL")?.name).toBe("Netherlands");
    expect(findDeliveryZone([world, nl, eu], "DE")?.name).toBe("EU");
    expect(findDeliveryZone([world, nl, eu], "US")?.name).toBe("World");
    expect(findDeliveryZone([nl, eu], "US")).toBeNull();
  });
  it("ignores inactive and pickup zones", () => {
    expect(findDeliveryZone([{ ...nl, isActive: false }, world], "NL")?.name).toBe("World");
    expect(findDeliveryZone([{ ...pickup, countries: ["NL"] }], "NL")).toBeNull();
  });
});

describe("calculateShippingQuote", () => {
  it("quotes the country's zone tier plus pickup", () => {
    const r = q([nl, eu, world, pickup], "nl", 999);
    expect(r).toEqual({
      deliverable: true,
      deliveryUnavailable: null,
      options: [
        { zoneId: nl.id, name: "Netherlands", price: 500, basePrice: 500, freeShipping: false, isPickup: false, maxWeightGrams: 1000, insurance: { price: 250, maxInsuredValue: 50000 } },
        { zoneId: pickup.id, name: "Pickup in store", price: 0, basePrice: 0, freeShipping: false, isPickup: true, maxWeightGrams: null, insurance: null },
      ],
    });
  });

  it("rounds fractional weights up before tier lookup", () => {
    const r = q([nl], "NL", 1000.2);
    expect(r.deliverable && r.options[0].price).toBe(900);
  });

  it("falls back to rest of world", () => {
    const r = q([nl, world], "JP", 1500);
    expect(r.deliverable && r.options.map((o) => [o.name, o.price])).toEqual([["World", 2500]]);
  });

  it("overweight → zone does not deliver (no highest-tier fallback)", () => {
    expect(q([nl], "NL", 5001)).toEqual({ deliverable: false, reason: "NOT_DELIVERABLE", detail: "OVERWEIGHT" });
    // …but pickup still works, with the reason exposed.
    const r = q([nl, pickup], "NL", 5001);
    expect(r).toMatchObject({ deliverable: true, deliveryUnavailable: "OVERWEIGHT" });
    expect(r.deliverable && r.options.map((o) => o.isPickup)).toEqual([true]);
  });

  it("not deliverable without a matching zone, or a zone without rates", () => {
    expect(q([nl, eu], "US", 100)).toEqual({ deliverable: false, reason: "NOT_DELIVERABLE", detail: "NO_ZONE" });
    expect(q([{ ...nl, rates: [] }], "NL", 100)).toEqual({ deliverable: false, reason: "NOT_DELIVERABLE", detail: "NO_RATES" });
  });

  it("rejects invalid country codes", () => {
    expect(q([world], "XX", 100)).toEqual({ deliverable: false, reason: "NOT_DELIVERABLE", detail: "INVALID_COUNTRY" });
    expect(q([world], "*", 100)).toMatchObject({ detail: "INVALID_COUNTRY" });
  });

  it("blocked countries remove delivery but keep pickup", () => {
    expect(q([nl, world], "NL", 100, { blockedCountries: ["nl"] })).toMatchObject({ deliverable: false, detail: "COUNTRY_BLOCKED" });
    const r = q([nl, pickup], "NL", 100, { blockedCountries: ["NL"] });
    expect(r).toMatchObject({ deliverable: true, deliveryUnavailable: "COUNTRY_BLOCKED" });
  });

  it("applies the free-shipping threshold to delivery only (inclusive)", () => {
    const paidPickup = { ...pickup, rates: [rate(1, 150)] };
    const below = q([nl, paidPickup], "NL", 100, { subtotal: 9999, freeShippingThreshold: 10000 });
    expect(below.deliverable && below.options.map((o) => o.price)).toEqual([500, 150]);
    const at = q([nl, paidPickup], "NL", 100, { subtotal: 10000, freeShippingThreshold: 10000 });
    expect(at.deliverable && at.options.map((o) => [o.price, o.basePrice, o.freeShipping])).toEqual([
      [0, 500, true],
      [150, 150, false],
    ]);
    const off = q([nl], "NL", 100, { subtotal: 10000, freeShippingThreshold: 0 });
    expect(off.deliverable && off.options[0].price).toBe(500);
  });

  it("only offers insurance within the insured limit", () => {
    const over = q([nl], "NL", 100, { subtotal: 50001 });
    expect(over.deliverable && over.options[0].insurance).toBeNull();
  });

  it("pickup zones with countries only show for those countries", () => {
    const localPickup = { ...pickup, countries: ["NL", "BE"] };
    expect(q([world, localPickup], "BE", 100).deliverable && (q([world, localPickup], "BE", 100) as { options: unknown[] }).options).toHaveLength(2);
    const r = q([world, localPickup], "DE", 100);
    expect(r.deliverable && r.options.map((o) => o.name)).toEqual(["World"]);
    expect(q([{ ...localPickup, isActive: false }], "NL", 1)).toMatchObject({ deliverable: false });
  });

  it("rejects negative input", () => {
    expect(() => q([nl], "NL", -1)).toThrow(RangeError);
    expect(() => q([nl], "NL", 1, { subtotal: -1 })).toThrow(RangeError);
  });
});
