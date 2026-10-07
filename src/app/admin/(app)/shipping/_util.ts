/* Pure display helpers for the shipping screen (shared by server and client components). */

export function formatWeight(grams: number): string {
  if (grams < 1000) return `${grams} g`;
  const kg = grams / 1000;
  return `${Number.isInteger(kg) ? kg : kg.toLocaleString("en-NL", { maximumFractionDigits: 3 })} kg`;
}

/** "up to 2 kg", "2–5 kg" for tier i of an ascending list of max weights. */
export function tierLabel(maxWeights: number[], i: number): string {
  if (i === 0) return `up to ${formatWeight(maxWeights[0])}`;
  return `${formatWeight(maxWeights[i - 1])} – ${formatWeight(maxWeights[i])}`;
}

export const UNAVAILABLE_REASON: Record<string, string> = {
  INVALID_COUNTRY: "Unknown country code.",
  COUNTRY_BLOCKED: "Delivery to this country is blocked for this cart.",
  NO_ZONE: "No active delivery zone covers this country.",
  NO_RATES: "The zone for this country has no weight tiers, so it offers no delivery.",
  OVERWEIGHT: "The parcel is heavier than the zone's highest weight tier. Add a higher tier to ship it.",
};

/** kg text ("2,5" or "2.5") → grams, or null. */
export function parseKg(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
}
