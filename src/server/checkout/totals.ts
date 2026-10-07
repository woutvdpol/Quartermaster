// Pure checkout money logic (no server-only, no DB) — unit-testable. All amounts are integer minor
// units of the shop currency; nothing here ever takes a price from the client.
import type { QuoteResult, QuoteZone, ShippingOption } from "@/server/shipping/calc";
import { COUNTRY_CODES, REST_OF_WORLD, isCountryCode, type CountryCode } from "@/server/shipping/countries";

export type Totals = {
  subtotal: number;
  /** Shipping price of the chosen option (after free shipping). */
  shipping: number;
  /** Insurance charge (only when chosen and offered). */
  insurance: number;
  /** shipping + insurance — stored as Order.shippingTotal. */
  shippingTotal: number;
  total: number;
};

export function computeTotals(prices: readonly number[], option: ShippingOption | null, insurance: boolean): Totals {
  for (const p of prices) if (!Number.isSafeInteger(p) || p < 0) throw new RangeError("price must be a non-negative integer");
  const subtotal = prices.reduce((s, p) => s + p, 0);
  const shipping = option?.price ?? 0;
  const ins = option && insurance && option.insurance ? option.insurance.price : 0;
  return { subtotal, shipping, insurance: ins, shippingTotal: shipping + ins, total: subtotal + shipping + ins };
}

export type FreeShippingProgress = { threshold: number; remaining: number; reached: boolean } | null;

export function freeShippingProgress(subtotal: number, threshold: number): FreeShippingProgress {
  if (!threshold || threshold <= 0) return null;
  const remaining = Math.max(0, threshold - subtotal);
  return { threshold, remaining, reached: remaining === 0 };
}

export function minimumOrderShortfall(subtotal: number, minimum: number): number {
  return minimum > 0 && subtotal < minimum ? minimum - subtotal : 0;
}

/** Picks the chosen option from a quote by id (= zone id). Never falls back to a cheaper one. */
export function selectOption(quote: QuoteResult, optionId: string | null | undefined): ShippingOption | null {
  if (!quote.deliverable || !optionId) return null;
  return quote.options.find((o) => o.zoneId === optionId) ?? null;
}

/**
 * Countries the checkout country select offers: every country served by an active delivery zone
 * (all countries when a rest-of-world zone exists) plus pickup-zone countries. Sorted by code.
 */
export function deliverableCountries(zones: readonly QuoteZone[]): CountryCode[] {
  const active = zones.filter((z) => z.isActive);
  const all = active.some(
    (z) => (!z.isPickup && z.countries.includes(REST_OF_WORLD) && z.rates.length > 0) || (z.isPickup && (z.countries.length === 0 || z.countries.includes(REST_OF_WORLD))),
  );
  if (all) return [...COUNTRY_CODES];
  const set = new Set<CountryCode>();
  for (const z of active) {
    if (!z.isPickup && z.rates.length === 0) continue;
    for (const c of z.countries) if (isCountryCode(c)) set.add(c);
  }
  return [...set].sort();
}
