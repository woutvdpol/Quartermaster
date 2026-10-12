// Bid increments (pure: no server-only, no DB) — shared by the bidding engine, the shop bid box and tests.
// docs/auctions-plan.md § Biedstappen. Amounts are minor units (cents).

/** One band of the increment table: amounts below `upTo` (null = no upper bound) step by `step`. */
export type IncrementBand = { upTo: number | null; step: number };
export type IncrementTable = readonly IncrementBand[];

/**
 * The shop default: up to €100 → €5, up to €500 → €10, up to €1,000 → €25, above → €50.
 * "Up to" is exclusive: at exactly €100 the next step is €10 (the band of the amount itself).
 */
export const DEFAULT_INCREMENT_TABLE: IncrementTable = Object.freeze([
  { upTo: 10_000, step: 500 },
  { upTo: 50_000, step: 1_000 },
  { upTo: 100_000, step: 2_500 },
  { upTo: null, step: 5_000 },
]);

/**
 * Validates a stored/entered table (Auction.incrementTable JSON). Bands must have positive integer
 * steps, strictly increasing `upTo` and end with an open band (`upTo: null`). Returns null when invalid.
 */
export function parseIncrementTable(raw: unknown): IncrementTable | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return null;
  const out: IncrementBand[] = [];
  let prev = 0;
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i] as { upTo?: unknown; step?: unknown } | null;
    if (!b || typeof b !== "object") return null;
    const step = b.step;
    if (typeof step !== "number" || !Number.isInteger(step) || step <= 0 || step > 100_000_000) return null;
    const last = i === raw.length - 1;
    if (last) {
      if (b.upTo !== null && b.upTo !== undefined) return null;
      out.push({ upTo: null, step });
    } else {
      const upTo = b.upTo;
      if (typeof upTo !== "number" || !Number.isInteger(upTo) || upTo <= prev) return null;
      out.push({ upTo, step });
      prev = upTo;
    }
  }
  return out;
}

/** The table to use for an auction: its own (when valid) or the default. */
export function tableOrDefault(raw: unknown): IncrementTable {
  return (raw === null || raw === undefined ? null : parseIncrementTable(raw)) ?? DEFAULT_INCREMENT_TABLE;
}

/** The step that applies above `amount` (the band `amount` falls in). */
export function incrementFor(amount: number, table: IncrementTable = DEFAULT_INCREMENT_TABLE): number {
  for (const band of table) if (band.upTo === null || amount < band.upTo) return band.step;
  return table[table.length - 1]?.step ?? DEFAULT_INCREMENT_TABLE[DEFAULT_INCREMENT_TABLE.length - 1].step;
}

/** The lowest acceptable bid: the start price while there is no bid, else current + one step. */
export function nextMinimum(current: number | null, startPrice: number, table: IncrementTable = DEFAULT_INCREMENT_TABLE): number {
  if (current === null) return startPrice;
  return current + incrementFor(current, table);
}

/** Rounds `amount` down to a "sensible" price step for start prices: €1 below €20, €5 below €100, €10 below €1,000, else €50. */
export function roundStartPrice(amount: number): number {
  const step = amount < 2_000 ? 100 : amount < 10_000 ? 500 : amount < 100_000 ? 1_000 : 5_000;
  return Math.max(100, Math.floor(amount / step) * step);
}

/** Default start price: 60% of the list price, rounded down to a sensible step (at least €1). */
export function defaultStartPrice(listPrice: number): number {
  return roundStartPrice(Math.round(listPrice * 0.6));
}

/** Default (hidden) reserve: purchase price + 10%, rounded up to whole euros; null when unknown. */
export function defaultReservePrice(purchasePrice: number | null | undefined, listPrice?: number | null): number | null {
  if (purchasePrice === null || purchasePrice === undefined || purchasePrice <= 0) return null;
  const reserve = Math.ceil((purchasePrice * 11) / 1000) * 100; // integer maths: 1.1 is not exact in floating point
  // Never above the list price: a reserve the shop itself wouldn't ask means the lot can't sell.
  return listPrice && listPrice > 0 ? Math.min(reserve, listPrice) : reserve;
}
