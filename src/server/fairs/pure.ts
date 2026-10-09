// Fair mode (docs/fair-mode.md): pure helpers shared by the service, the admin screens and the
// fair-mode client. No server imports here — the phone client bundles this file.

export const FAIR_PAYMENT_METHODS = ["card", "cash", "invoice"] as const;
export type FairPaymentMethod = (typeof FAIR_PAYMENT_METHODS)[number];

export const FAIR_METHOD_LABELS: Record<FairPaymentMethod, string> = { card: "Card", cash: "Cash", invoice: "Invoice" };

/** Suggested floor: list price −15%. */
export const DEFAULT_FLOOR_DISCOUNT = 0.15;

/** Rounding step for a suggested floor (minor units, 2-decimal currencies): nicer numbers for bigger prices. */
export function floorStep(price: number): number {
  if (price < 2_000) return 100; // < €20 → whole euros
  if (price < 10_000) return 500; // < €100 → €5
  if (price < 100_000) return 1_000; // < €1,000 → €10
  return 5_000; // → €50
}

/**
 * Default floor for an item: list −15%, rounded to the nearest step, never above the list price and
 * never negative. 1450.00 → 1250.00, 145.00 → 120.00, 45.00 → 40.00.
 */
export function defaultFloorPrice(listPrice: number): number {
  if (!Number.isFinite(listPrice) || listPrice <= 0) return 0;
  const raw = listPrice * (1 - DEFAULT_FLOOR_DISCOUNT);
  const step = floorStep(listPrice);
  const rounded = Math.round(raw / step) * step;
  return Math.max(0, Math.min(listPrice, rounded));
}

/** The lowest price staff may enter without an explicit override: the item's floor, else its list price. */
export function effectiveFloor(floorPrice: number | null | undefined, listPrice: number): number {
  return floorPrice ?? listPrice;
}

/** Stock codes are positive integers (legacy ids from 1, new ones from 50000). */
const STOCK_CODE = /^\d{1,9}$/;

/**
 * Stock code from what the scanner / keyboard produced: a bare number ("50160", "No. 50160") or a
 * product URL as printed on the QR label (`https://shop.example/product/50160/slug`).
 */
export function stockCodeFromScan(text: string): number | null {
  const raw = text.trim();
  if (!raw) return null;
  const fromPath = /\/product\/(\d{1,9})(?:[/?#]|$)/.exec(raw);
  const candidate = fromPath ? fromPath[1] : raw.replace(/^(?:no\.?|#)\s*/i, "");
  if (!STOCK_CODE.test(candidate)) return null;
  const n = Number(candidate);
  return n > 0 ? n : null;
}

/** Idempotency key format sent by the client (crypto.randomUUID, or a fallback of similar shape). */
export const CLIENT_REF_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

// ─── Report ─────────────────────────────────────────────────────────────────

export type FairSaleFact = {
  orderId: string;
  orderNumber: number;
  stockCode: number;
  title: string;
  price: number;
  listPrice: number;
  purchasePrice: number | null;
  method: string | null;
  soldAt: Date | string;
};

export type FairReport = {
  count: number;
  revenue: number;
  byMethod: Record<FairPaymentMethod | "other", { count: number; amount: number }>;
  /** Σ (price − purchase price) over sales with a known purchase price. */
  margin: number;
  /** Sales without a purchase price (excluded from the margin). */
  marginUnknown: number;
  listTotal: number;
  /** (revenue − list total) / list total, e.g. −0.04 = 4% below list on average. null without sales. */
  averageVsList: number | null;
  /** Cash that should be in the box. */
  cashExpected: number;
  latest: FairSaleFact[];
};

const asTime = (d: Date | string) => (d instanceof Date ? d.getTime() : Date.parse(d));

/** End-of-fair (and live) report figures from the fair's sales. Amounts in minor units. */
export function computeFairReport(sales: FairSaleFact[], latestCount = 5): FairReport {
  const byMethod: FairReport["byMethod"] = {
    card: { count: 0, amount: 0 },
    cash: { count: 0, amount: 0 },
    invoice: { count: 0, amount: 0 },
    other: { count: 0, amount: 0 },
  };
  let revenue = 0;
  let margin = 0;
  let marginUnknown = 0;
  let listTotal = 0;
  for (const s of sales) {
    revenue += s.price;
    listTotal += s.listPrice;
    const key = (FAIR_PAYMENT_METHODS as readonly string[]).includes(s.method ?? "") ? (s.method as FairPaymentMethod) : "other";
    byMethod[key].count += 1;
    byMethod[key].amount += s.price;
    if (s.purchasePrice == null) marginUnknown += 1;
    else margin += s.price - s.purchasePrice;
  }
  const latest = [...sales].sort((a, b) => asTime(b.soldAt) - asTime(a.soldAt)).slice(0, latestCount);
  return {
    count: sales.length,
    revenue,
    byMethod,
    margin,
    marginUnknown,
    listTotal,
    averageVsList: listTotal > 0 ? (revenue - listTotal) / listTotal : null,
    cashExpected: byMethod.cash.amount,
    latest,
  };
}
