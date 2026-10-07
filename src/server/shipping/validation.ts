// Pure input schemas + rules for shipping zones/rates (no server-only, no DB) — unit-testable.
//
// Zone model (decision 21, replaces legacy region × weight):
//  - `countries` = ISO 3166-1 alpha-2 codes, upper-case, unique, sorted. `["*"]` = rest of world.
//  - A country may be in at most ONE non-pickup zone per tenant, and at most one non-pickup zone may be
//    the rest-of-world zone. So zone matching for delivery is unambiguous; `sortOrder` is display order.
//    The rule includes inactive zones (simple + deterministic: re-activating never creates overlaps).
//  - Pickup zones (`isPickup`) are exempt: they describe where "pickup in store" is offered.
//    Empty `countries` (or `["*"]`) on a pickup zone = offered to every customer.
import { z } from "zod";
import { REST_OF_WORLD, isCountryCode } from "./countries";

/** Upper bound for a weight tier: 1,000 kg. */
export const MAX_WEIGHT_GRAMS = 1_000_000;
/** Upper bound for a price: 1,000,000.00 in minor units. */
export const MAX_PRICE = 100_000_000;
export const MAX_TIERS_PER_ZONE = 100;

/**
 * Countries list: trims/upper-cases, rejects unknown codes, de-duplicates and sorts.
 * "*" (rest of world) must be the only entry.
 */
export const countriesSchema = z
  .array(z.string().trim().toUpperCase())
  .max(300)
  .superRefine((list, ctx) => {
    list.forEach((code, i) => {
      if (code !== REST_OF_WORLD && !isCountryCode(code)) {
        ctx.addIssue({ code: "custom", path: [i], message: `Unknown country code "${code}"` });
      }
    });
    if (list.includes(REST_OF_WORLD) && new Set(list).size > 1) {
      ctx.addIssue({ code: "custom", message: `"${REST_OF_WORLD}" (rest of world) cannot be combined with other countries` });
    }
  })
  .transform((list) => [...new Set(list)].sort());

const money = z.int().min(0).max(MAX_PRICE);

export const rateSchema = z
  .object({
    maxWeightGrams: z.int().min(1).max(MAX_WEIGHT_GRAMS),
    price: money,
    insurancePrice: money.nullish().transform((v) => v ?? null),
    maxInsuredValue: z
      .int()
      .min(1)
      .max(MAX_PRICE * 10)
      .nullish()
      .transform((v) => v ?? null),
  })
  .superRefine((r, ctx) => {
    if (r.maxInsuredValue !== null && r.insurancePrice === null) {
      ctx.addIssue({ code: "custom", path: ["maxInsuredValue"], message: "Set an insurance price when limiting the insured value" });
    }
  });

/** Weight tiers: no duplicate maxWeightGrams; output sorted ascending by weight. */
export const ratesSchema = z
  .array(rateSchema)
  .max(MAX_TIERS_PER_ZONE)
  .superRefine((rates, ctx) => {
    const seen = new Set<number>();
    rates.forEach((r, i) => {
      if (seen.has(r.maxWeightGrams)) {
        ctx.addIssue({ code: "custom", path: [i, "maxWeightGrams"], message: `Duplicate weight tier ${r.maxWeightGrams} g` });
      }
      seen.add(r.maxWeightGrams);
    });
  })
  .transform((rates) => [...rates].sort((a, b) => a.maxWeightGrams - b.maxWeightGrams));

const nameSchema = z.string().trim().min(1).max(100);
const sortOrderSchema = z.int().min(0).max(100_000);

export const createZoneSchema = z
  .object({
    name: nameSchema,
    countries: countriesSchema.default([]),
    isPickup: z.boolean().default(false),
    isActive: z.boolean().default(true),
    sortOrder: sortOrderSchema.optional(),
    rates: ratesSchema.default([]),
  })
  .superRefine((z, ctx) => {
    if (!z.isPickup && z.countries.length === 0) {
      ctx.addIssue({ code: "custom", path: ["countries"], message: "A delivery zone needs at least one country (or * for rest of world)" });
    }
  });

export const updateZoneSchema = z.object({
  name: nameSchema.optional(),
  countries: countriesSchema.optional(),
  isPickup: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: sortOrderSchema.optional(),
});

export type CreateZoneInput = z.input<typeof createZoneSchema>;
export type UpdateZoneInput = z.input<typeof updateZoneSchema>;
export type RateInput = z.input<typeof rateSchema>;
export type Rate = z.output<typeof rateSchema>;

export type ZoneCountryInfo = { id: string; name: string; countries: readonly string[]; isPickup: boolean };
export type CountryConflict = { country: string; zoneId: string; zoneName: string };

/**
 * Countries of `candidate` already claimed by another non-pickup zone (the one-zone-per-country rule).
 * Pickup candidates never conflict. "*" conflicts with another "*" zone.
 */
export function findCountryConflicts(candidate: ZoneCountryInfo, others: readonly ZoneCountryInfo[]): CountryConflict[] {
  if (candidate.isPickup) return [];
  const owner = new Map<string, ZoneCountryInfo>();
  for (const z of others) {
    if (z.isPickup || z.id === candidate.id) continue;
    for (const c of z.countries) if (!owner.has(c)) owner.set(c, z);
  }
  const conflicts: CountryConflict[] = [];
  for (const c of candidate.countries) {
    const z = owner.get(c);
    if (z) conflicts.push({ country: c, zoneId: z.id, zoneName: z.name });
  }
  return conflicts;
}
