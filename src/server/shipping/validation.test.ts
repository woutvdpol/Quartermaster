import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, countryName, isCountryCode, normalizeCountryCode } from "./countries";
import { countriesSchema, createZoneSchema, findCountryConflicts, ratesSchema, updateZoneSchema } from "./validation";

describe("countries", () => {
  it("has all 249 ISO 3166-1 alpha-2 codes, upper-case and unique", () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    expect(COUNTRY_CODES.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
  });
  it("validates and normalizes codes", () => {
    expect(isCountryCode("NL")).toBe(true);
    expect(isCountryCode("nl")).toBe(false);
    expect(isCountryCode("UK")).toBe(false); // GB is the ISO code
    expect(isCountryCode("toString")).toBe(false);
    expect(normalizeCountryCode(" be ")).toBe("BE");
    expect(normalizeCountryCode("XX")).toBeNull();
    expect(countryName("DE")).toBe("Germany");
  });
});

describe("countriesSchema", () => {
  it("upper-cases, dedupes and sorts", () => {
    expect(countriesSchema.parse(["nl", " BE", "NL", "lu"])).toEqual(["BE", "LU", "NL"]);
  });
  it("rejects unknown codes", () => {
    const r = countriesSchema.safeParse(["NL", "XX"]);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toContain("XX");
  });
  it("accepts * alone but not combined", () => {
    expect(countriesSchema.parse(["*"])).toEqual(["*"]);
    expect(countriesSchema.safeParse(["*", "NL"]).success).toBe(false);
  });
});

describe("ratesSchema", () => {
  it("sorts tiers ascending and fills optional insurance", () => {
    expect(ratesSchema.parse([{ maxWeightGrams: 5000, price: 900 }, { maxWeightGrams: 1000, price: 500 }])).toEqual([
      { maxWeightGrams: 1000, price: 500, insurancePrice: null, maxInsuredValue: null },
      { maxWeightGrams: 5000, price: 900, insurancePrice: null, maxInsuredValue: null },
    ]);
  });
  it("rejects duplicate tiers, non-integers and negatives", () => {
    expect(ratesSchema.safeParse([{ maxWeightGrams: 1000, price: 1 }, { maxWeightGrams: 1000, price: 2 }]).success).toBe(false);
    expect(ratesSchema.safeParse([{ maxWeightGrams: 0, price: 1 }]).success).toBe(false);
    expect(ratesSchema.safeParse([{ maxWeightGrams: 10, price: 1.5 }]).success).toBe(false);
    expect(ratesSchema.safeParse([{ maxWeightGrams: 10, price: -1 }]).success).toBe(false);
  });
  it("requires an insurance price when an insured limit is set", () => {
    expect(ratesSchema.safeParse([{ maxWeightGrams: 10, price: 1, maxInsuredValue: 100 }]).success).toBe(false);
    expect(ratesSchema.safeParse([{ maxWeightGrams: 10, price: 1, insurancePrice: 5, maxInsuredValue: 100 }]).success).toBe(true);
  });
});

describe("zone schemas", () => {
  it("delivery zones need countries; pickup zones don't", () => {
    expect(createZoneSchema.safeParse({ name: "Empty", countries: [] }).success).toBe(false);
    expect(createZoneSchema.parse({ name: "Pickup", isPickup: true })).toMatchObject({ countries: [], isPickup: true, isActive: true, rates: [] });
  });
  it("trims names and rejects blanks", () => {
    expect(createZoneSchema.parse({ name: "  EU ", countries: ["DE"] }).name).toBe("EU");
    expect(updateZoneSchema.safeParse({ name: "  " }).success).toBe(false);
  });
});

describe("findCountryConflicts", () => {
  const zones = [
    { id: "a", name: "Benelux", countries: ["BE", "LU", "NL"], isPickup: false },
    { id: "b", name: "World", countries: ["*"], isPickup: false },
    { id: "p", name: "Pickup", countries: ["NL"], isPickup: true },
  ];
  it("reports countries owned by another delivery zone", () => {
    expect(findCountryConflicts({ id: "", name: "NL", countries: ["NL", "DE"], isPickup: false }, zones)).toEqual([
      { country: "NL", zoneId: "a", zoneName: "Benelux" },
    ]);
  });
  it("allows only one rest-of-world zone", () => {
    expect(findCountryConflicts({ id: "", name: "World 2", countries: ["*"], isPickup: false }, zones)).toHaveLength(1);
  });
  it("ignores the zone itself and pickup zones", () => {
    expect(findCountryConflicts({ ...zones[0] }, zones)).toEqual([]);
    expect(findCountryConflicts({ id: "x", name: "Pickup 2", countries: ["NL"], isPickup: true }, zones)).toEqual([]);
  });
});
