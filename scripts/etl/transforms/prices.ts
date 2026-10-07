/**
 * Order line price reconstruction (docs/analysis/04 §1).
 *
 * Concept500 wrote `order_details.price = Money::getAmount() × qty` into an INT column: the LINE
 * TOTAL in WHOLE euros (44.62 → 45, 2 × 44.62 → 89, 0.16 → 0). Cents are lost. `orders.total` is
 * correct (minor units, incl. delivery and any payment surcharge). We therefore rebuild the line
 * totals from the order:
 *
 *   goods = orders.total − orders.delivery
 *
 * 1. "product-price": the current `products.price × qty` of every line adds up to `goods` exactly
 *    → use those (the common case: unique items whose price never changed).
 * 2. "product-price+surcharge": the payment method had a surcharge % and
 *    goods ≈ Σ product prices × (1 + pct/100) (±1 cent per line) → lines = product prices,
 *    difference = surcharge.
 * 3. "proportional": distribute `goods` over the lines in proportion to the rounded legacy euros
 *    (largest-remainder, so the cents add up exactly). When all rounded amounts are 0 the product
 *    prices are the weights, and when those are unknown/0 too the split is equal.
 *
 * Every result satisfies Σ lineTotal + surcharge = goods (or goods < 0 → everything 0, flagged).
 */

export type ReconstructLine = {
  quantity: number;
  /** legacy order_details.price (rounded whole-euro line total) */
  roundedEuros: number;
  /** current products.price in minor units, null when the product no longer exists */
  productPrice: number | null;
};

export type ReconstructedLine = { lineTotal: number; unitPrice: number; quantity: number };

export type ReconstructMethod = "product-price" | "product-price+surcharge" | "proportional" | "none";

export type ReconstructResult = {
  method: ReconstructMethod;
  lines: ReconstructedLine[];
  subtotal: number;
  surcharge: number;
  /** goods − Σ rounded euros × 100: how far the legacy line amounts were off (for the report). */
  roundingDelta: number;
  /** set when the inputs were inconsistent (negative goods, zero quantity, …) */
  warning?: string;
};

/** Largest-remainder split of `total` (≥ 0, integer) by non-negative `weights`. */
export function distribute(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  const w = sum > 0 ? weights.map((x) => Math.max(0, x)) : weights.map(() => 1);
  const wSum = sum > 0 ? sum : n;
  const exact = w.map((x) => (total * x) / wSum);
  const floors = exact.map((x) => Math.floor(x));
  let rest = total - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0; k = (k + 1) % n, rest--) floors[order[k].i] += 1;
  return floors;
}

export function reconstructLinePrices(input: {
  total: number;
  delivery: number;
  lines: ReconstructLine[];
  /** payment_methods.surcharge (percentage) of the order's payment method, 0/null when none */
  surchargePercent?: number | null;
}): ReconstructResult {
  const lines = input.lines.map((l) => ({ ...l, quantity: l.quantity > 0 ? l.quantity : 1 }));
  const warnings: string[] = [];
  if (input.lines.some((l) => l.quantity <= 0)) warnings.push("quantity ≤ 0 treated as 1");
  const goods = input.total - input.delivery;
  const roundedSum = lines.reduce((a, l) => a + Math.max(0, l.roundedEuros) * 100, 0);
  const roundingDelta = goods - roundedSum;

  const finish = (method: ReconstructMethod, totals: number[], surcharge: number): ReconstructResult => ({
    method,
    lines: totals.map((t, i) => ({ lineTotal: t, quantity: lines[i].quantity, unitPrice: Math.round(t / lines[i].quantity) })),
    subtotal: totals.reduce((a, b) => a + b, 0),
    surcharge,
    roundingDelta,
    ...(warnings.length ? { warning: warnings.join("; ") } : {}),
  });

  if (lines.length === 0) return { method: "none", lines: [], subtotal: Math.max(0, goods), surcharge: 0, roundingDelta };
  if (goods < 0) {
    warnings.push("orders.total < delivery");
    return finish("proportional", lines.map(() => 0), 0);
  }

  const known = lines.every((l) => l.productPrice !== null && l.productPrice >= 0);
  if (known) {
    const productTotals = lines.map((l) => (l.productPrice as number) * l.quantity);
    const base = productTotals.reduce((a, b) => a + b, 0);
    if (base === goods) return finish("product-price", productTotals, 0);
    const pct = input.surchargePercent ?? 0;
    if (pct > 0 && base > 0 && goods > base) {
      const expected = Math.round((base * pct) / 100);
      if (Math.abs(goods - base - expected) <= lines.length) return finish("product-price+surcharge", productTotals, goods - base);
    }
  }

  const rounded = lines.map((l) => Math.max(0, l.roundedEuros));
  const weights = rounded.some((x) => x > 0) ? rounded : lines.map((l) => (l.productPrice ?? 0) * l.quantity);
  return finish("proportional", distribute(goods, weights), 0);
}
