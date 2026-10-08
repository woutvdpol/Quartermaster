import type { PublicProduct } from "@/server/storefront-catalog/types";
import type { SeoShop } from "../json-ld";
import type { QuoteZone } from "@/server/shipping/calc";

/** Test fixtures for the SEO builders. */
export const ORIGIN = "https://shop.example";

export function shopFixture(over: Partial<SeoShop> = {}): SeoShop {
  return {
    origin: ORIGIN,
    name: "Example Militaria",
    currency: "EUR",
    description: "Militaria from WW1 to the Cold War.",
    logoPath: "/uploads/t1/logo.png",
    email: "info@shop.example",
    phone: "+31 6 1234 5678",
    address: { line1: "Dorpsstraat 1", line2: "", postalCode: "1234 AB", city: "Utrecht", country: "NL" },
    sameAs: ["https://www.instagram.com/example"],
    vatNumber: "NL123456789B01",
    cocNumber: "12345678",
    returns: { days: 14, fees: "customer", countries: ["NL", "BE"] },
    ...over,
  };
}

export function productFixture(over: Partial<PublicProduct> = {}): PublicProduct {
  return {
    id: "p1",
    tenantId: "t1",
    stockCode: 1234,
    sku: null,
    slug: "m35-helmet",
    href: "/product/1234/m35-helmet",
    title: "German M35 helmet",
    description: "Original **M35** helmet with liner.\n\nGood condition.",
    specifications: [
      { label: "Size", value: "64" },
      { label: "Period", value: "duplicate of the facet" },
      { label: "Condition", value: "Very good" },
    ],
    price: 45000,
    status: "available",
    onSale: false,
    weightGrams: 1200,
    blurred: false,
    ageRestricted: false,
    restrictedSymbols: false,
    acceptsOffers: false,
    publishedAt: "2026-01-01T00:00:00.000Z",
    soldAt: null,
    updatedAt: "2026-02-01T00:00:00.000Z",
    seoTitle: null,
    seoDescription: null,
    categoryId: "c2",
    categoryPath: [
      { id: "c1", title: "Helmets", slug: "helmets" },
      { id: "c2", title: "German", slug: "german-helmets" },
    ],
    tags: [],
    facets: [
      { facet: { id: "f1", kind: "PERIOD", name: "Period", slug: "period", isFilterable: true }, values: [{ id: "v1", name: "WW2", slug: "ww2", token: "period.ww2", path: ["WW2"] }] },
      { facet: { id: "f2", kind: "MAKER", name: "Maker", slug: "maker", isFilterable: true }, values: [{ id: "v2", name: "Quist", slug: "quist", token: "maker.quist", path: ["Quist"] }] },
      { facet: { id: "f3", kind: "COUNTRY", name: "Country", slug: "country", isFilterable: true }, values: [{ id: "v3", name: "Germany", slug: "germany", token: "country.germany", path: ["Germany"] }] },
    ],
    requiresDeactivationCert: false,
    images: [
      { id: "i1", alt: null, width: 3000, height: 2000, thumb: "/uploads/a/thumb.webp", card: "/uploads/a/card.webp", large: "/uploads/a/large.webp", blur: "/uploads/a/blur.webp", blurDataUrl: null },
      { id: "i2", alt: "Liner", width: 1600, height: 1200, thumb: "/uploads/b/thumb.webp", card: "/uploads/b/card.webp", large: "/uploads/b/large.webp", blur: "/uploads/b/blur.webp", blurDataUrl: null },
    ],
    relatedIds: [],
    ...over,
  };
}

export const ZONES: QuoteZone[] = [
  { id: "z1", name: "Benelux", countries: ["NL", "BE", "LU"], isPickup: false, isActive: true, sortOrder: 0, rates: [{ maxWeightGrams: 2000, price: 695, insurancePrice: null, maxInsuredValue: null }] },
  { id: "z2", name: "Europe", countries: ["DE", "FR"], isPickup: false, isActive: true, sortOrder: 1, rates: [{ maxWeightGrams: 1000, price: 1450, insurancePrice: null, maxInsuredValue: null }, { maxWeightGrams: 5000, price: 1950, insurancePrice: null, maxInsuredValue: null }] },
  { id: "z3", name: "Rest of world", countries: ["*"], isPickup: false, isActive: true, sortOrder: 2, rates: [{ maxWeightGrams: 5000, price: 2750, insurancePrice: null, maxInsuredValue: null }] },
  { id: "z4", name: "Pickup in store", countries: [], isPickup: true, isActive: true, sortOrder: 3, rates: [] },
  { id: "z5", name: "Inactive", countries: ["US"], isPickup: false, isActive: false, sortOrder: 4, rates: [{ maxWeightGrams: 5000, price: 5000, insurancePrice: null, maxInsuredValue: null }] },
];
