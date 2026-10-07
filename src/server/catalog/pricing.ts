/** Pure money helpers. All amounts are integer minor units (cents). */

/**
 * Applies a percentage change to a price in cents, e.g. `adjustPriceByPercent(1999, 10)` → 2199.
 *
 * Rounding: the percentage is taken to 2 decimals (basis points) and the result is rounded to whole
 * cents, half up (…,5 cent → up). Done in integer arithmetic so there is no float drift
 * (1999 × 1.1 = 2198.9 → 2199). The result is never negative.
 */
export function adjustPriceByPercent(priceCents: number, percent: number): number {
  if (!Number.isInteger(priceCents) || priceCents < 0) throw new RangeError("priceCents must be a non-negative integer");
  if (!Number.isFinite(percent)) throw new RangeError("percent must be finite");
  const bp = Math.round(percent * 100); // basis points
  const scaled = priceCents * (10000 + bp);
  if (scaled <= 0) return 0;
  return Math.floor((scaled + 5000) / 10000);
}

/** Margin in cents, or null when the cost basis is unknown. */
export function margin(price: number, purchasePrice: number | null | undefined): number | null {
  return purchasePrice == null ? null : price - purchasePrice;
}
