// Pure shipping quote calculation (no server-only, no DB). `quote.ts` fetches zones and calls this.
//
// Rules:
//  - Delivery zone = the active non-pickup zone listing the country; otherwise the active
//    rest-of-world zone (["*"]). Ties (only possible with legacy data) → lowest sortOrder wins.
//  - Tier = first rate (ascending) with maxWeightGrams ≥ cart weight. Weight 0 → first tier.
//  - OVERWEIGHT: heavier than the zone's highest tier → that zone does NOT deliver. We deliberately do
//    not fall back to the highest tier (legacy did a lookup that silently undercharged heavy parcels);
//    the owner adds a higher tier if they want to ship it.
//  - A delivery zone without any rates offers no delivery (NO_RATES) — misconfiguration, not "free".
//  - Free shipping: when `freeShippingThreshold` (minor units, > 0) is set and subtotal ≥ threshold,
//    delivery options cost 0 (pickup is unaffected). Insurance is still charged when chosen.
//  - `blockedCountries` (hook for category/product export blocks) removes delivery options only;
//    pickup in store stays available.
//  - Pickup zones: active, countries empty / ["*"] / containing the country. Weight is ignored; the price
//    is the zone's first (lowest-weight) tier, or 0 without rates.
//  - Result is NOT_DELIVERABLE only when no option at all remains (no delivery and no pickup).
import { REST_OF_WORLD, isCountryCode } from "./countries";

export type QuoteRate = {
  maxWeightGrams: number;
  price: number;
  insurancePrice: number | null;
  maxInsuredValue: number | null;
};

export type QuoteZone = {
  id: string;
  name: string;
  countries: readonly string[];
  isPickup: boolean;
  isActive: boolean;
  sortOrder: number;
  rates: readonly QuoteRate[];
};

export type QuoteInput = {
  countryCode: string;
  totalWeightGrams: number;
  /** Cart subtotal in minor units (for free-shipping threshold and insurance limits). */
  subtotal: number;
  /** Countries the cart can't be shipped to (product/category export blocks). */
  blockedCountries?: readonly string[];
  /** Minor units; null/0 = no free shipping. */
  freeShippingThreshold?: number | null;
};

export type ShippingOption = {
  zoneId: string;
  name: string;
  /** Minor units, tenant currency. */
  price: number;
  isPickup: boolean;
  /** Price before free shipping was applied. */
  basePrice: number;
  freeShipping: boolean;
  /** The tier used (null for pickup). */
  maxWeightGrams: number | null;
  /** Optional insurance for this option, if offered and the subtotal is within the insured limit. */
  insurance: { price: number; maxInsuredValue: number | null } | null;
};

export type DeliveryUnavailableReason = "INVALID_COUNTRY" | "COUNTRY_BLOCKED" | "NO_ZONE" | "NO_RATES" | "OVERWEIGHT";

export type QuoteResult =
  | {
      deliverable: true;
      options: ShippingOption[];
      /** Set when only pickup is possible: why home delivery isn't. */
      deliveryUnavailable: DeliveryUnavailableReason | null;
    }
  | { deliverable: false; reason: "NOT_DELIVERABLE"; detail: DeliveryUnavailableReason };

const bySort = (a: QuoteZone, b: QuoteZone) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** The delivery (non-pickup) zone serving a country, or null. */
export function findDeliveryZone(zones: readonly QuoteZone[], countryCode: string): QuoteZone | null {
  const delivery = zones.filter((z) => z.isActive && !z.isPickup).sort(bySort);
  return delivery.find((z) => z.countries.includes(countryCode)) ?? delivery.find((z) => z.countries.includes(REST_OF_WORLD)) ?? null;
}

/** First tier with maxWeightGrams ≥ weight (rates in any order), or null when overweight / no rates. */
export function findTier<R extends QuoteRate>(rates: readonly R[], weightGrams: number): R | null {
  const sorted = [...rates].sort((a, b) => a.maxWeightGrams - b.maxWeightGrams);
  return sorted.find((r) => r.maxWeightGrams >= weightGrams) ?? null;
}

function insuranceFor(rate: QuoteRate, subtotal: number): ShippingOption["insurance"] {
  if (rate.insurancePrice === null) return null;
  if (rate.maxInsuredValue !== null && subtotal > rate.maxInsuredValue) return null;
  return { price: rate.insurancePrice, maxInsuredValue: rate.maxInsuredValue };
}

export function calculateShippingQuote(zones: readonly QuoteZone[], input: QuoteInput): QuoteResult {
  const country = input.countryCode.trim().toUpperCase();
  if (!isCountryCode(country)) return { deliverable: false, reason: "NOT_DELIVERABLE", detail: "INVALID_COUNTRY" };
  if (!Number.isFinite(input.totalWeightGrams) || input.totalWeightGrams < 0) throw new RangeError("totalWeightGrams must be ≥ 0");
  if (!Number.isFinite(input.subtotal) || input.subtotal < 0) throw new RangeError("subtotal must be ≥ 0");
  const weight = Math.ceil(input.totalWeightGrams);

  const options: ShippingOption[] = [];
  let deliveryUnavailable: DeliveryUnavailableReason | null = null;

  const blocked = new Set((input.blockedCountries ?? []).map((c) => c.trim().toUpperCase()));
  const zone = findDeliveryZone(zones, country);
  if (blocked.has(country)) deliveryUnavailable = "COUNTRY_BLOCKED";
  else if (!zone) deliveryUnavailable = "NO_ZONE";
  else if (zone.rates.length === 0) deliveryUnavailable = "NO_RATES";
  else {
    const tier = findTier(zone.rates, weight);
    if (!tier) deliveryUnavailable = "OVERWEIGHT";
    else {
      const threshold = input.freeShippingThreshold ?? 0;
      const free = threshold > 0 && input.subtotal >= threshold;
      options.push({
        zoneId: zone.id,
        name: zone.name,
        price: free ? 0 : tier.price,
        basePrice: tier.price,
        freeShipping: free,
        isPickup: false,
        maxWeightGrams: tier.maxWeightGrams,
        insurance: insuranceFor(tier, input.subtotal),
      });
    }
  }

  const pickups = zones
    .filter((z) => z.isActive && z.isPickup)
    .filter((z) => z.countries.length === 0 || z.countries.includes(REST_OF_WORLD) || z.countries.includes(country))
    .sort(bySort);
  for (const z of pickups) {
    const first = findTier(z.rates, 0);
    const price = first?.price ?? 0;
    options.push({ zoneId: z.id, name: z.name, price, basePrice: price, freeShipping: false, isPickup: true, maxWeightGrams: null, insurance: null });
  }

  if (options.length === 0) return { deliverable: false, reason: "NOT_DELIVERABLE", detail: deliveryUnavailable ?? "NO_ZONE" };
  return { deliverable: true, options, deliveryUnavailable };
}
