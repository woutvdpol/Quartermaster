// Stock insights (docs/insights.md): pure helpers — period bounds, medians, sell-through, the
// "why is this sitting" heuristic, reprice suggestions, "buy more" picking and search-query
// normalisation. No server imports: unit-tested in pure.test.ts.

import { zonedParts, zonedTime } from "@/server/alerts/schedule";
import { floorStep } from "@/server/fairs/pure";

// ─── Period ─────────────────────────────────────────────────────────────────

export const INSIGHT_PERIODS = ["90d", "12m", "ytd"] as const;
export type InsightPeriod = (typeof INSIGHT_PERIODS)[number];
export const DEFAULT_PERIOD: InsightPeriod = "12m";

export function parseInsightPeriod(value: unknown): InsightPeriod {
  const v = Array.isArray(value) ? value[0] : value;
  return (INSIGHT_PERIODS as readonly unknown[]).includes(v) ? (v as InsightPeriod) : DEFAULT_PERIOD;
}

/** "Sitting too long" threshold (days since listing). */
export const STALE_DAY_OPTIONS = [90, 180, 365] as const;
export const DEFAULT_STALE_DAYS = 180;

export function parseStaleDays(value: unknown): number {
  const v = Number(Array.isArray(value) ? value[0] : value);
  return (STALE_DAY_OPTIONS as readonly number[]).includes(v) ? v : DEFAULT_STALE_DAYS;
}

export type PeriodBounds = { start: Date; end: Date; prevStart: Date; prevEnd: Date };

const DAY_MS = 86_400_000;

/**
 * Current window [start, end = now) and the previous equal window [prevStart, prevEnd).
 *  - 90d: the last 90 tenant-local days incl. today; previous = the 90 days before.
 *  - 12m: since the same local date a year ago; previous = the year before that.
 *  - ytd: since 1 January (local); previous = the same stretch of last year.
 */
export function periodBounds(period: InsightPeriod, now: Date, timeZone: string): PeriodBounds {
  const p = zonedParts(now, timeZone);
  if (period === "90d") {
    const start = zonedTime(p.year, p.month, p.day - 89, 0, timeZone); // Date.UTC rolls the day over
    const prevStart = zonedTime(p.year, p.month, p.day - 179, 0, timeZone);
    return { start, end: now, prevStart, prevEnd: start };
  }
  if (period === "12m") {
    const start = zonedTime(p.year - 1, p.month, p.day, 0, timeZone); // 29 Feb → 1 Mar
    const prevStart = zonedTime(p.year - 2, p.month, p.day, 0, timeZone);
    return { start, end: now, prevStart, prevEnd: start };
  }
  const start = zonedTime(p.year, 1, 1, 0, timeZone);
  const prevStart = zonedTime(p.year - 1, 1, 1, 0, timeZone);
  const prevEnd = new Date(prevStart.getTime() + (now.getTime() - start.getTime()));
  return { start, end: now, prevStart, prevEnd };
}

/** Local calendar day (YYYY-MM-DD) of an instant. */
export function localDay(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// ─── Math ───────────────────────────────────────────────────────────────────

/** Median of finite numbers (mean of the middle two for an even count); null when empty. */
export function median(values: readonly number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** Share of items listed in the period that sold (0–1); null when nothing was listed. */
export function sellThrough(listed: number, sold: number): number | null {
  if (!(listed > 0)) return null;
  return Math.min(1, Math.max(0, sold / listed));
}

/** Margin % with one decimal, as on the dashboard: (revenue − cost) / revenue over lines with a cost. */
export function marginPct(costedRevenue: number, cost: number): number | null {
  return costedRevenue > 0 ? Math.round(((costedRevenue - cost) / costedRevenue) * 1000) / 10 : null;
}

/** Whole days between two instants (floored, never negative). */
export function daysBetween(from: Date | string, to: Date | string): number {
  const a = typeof from === "string" ? Date.parse(from) : from.getTime();
  const b = typeof to === "string" ? Date.parse(to) : to.getTime();
  return Math.max(0, Math.floor((b - a) / DAY_MS));
}

/** Difference (current − previous), or null when either side is unknown. */
export function delta(current: number | null, previous: number | null): number | null {
  return current == null || previous == null ? null : current - previous;
}

// ─── Reprice ────────────────────────────────────────────────────────────────

/** Comparable sold items needed before a reprice is suggested. */
export const MIN_COMPARABLES = 3;
/** A suggestion must be at least this much below the current price to be worth a click. */
export const MIN_REPRICE_DROP = 0.05;

/** Rounds a price to the same "nice" steps as the fair floor (whole €, €5, €10, €50 by size). */
export function roundPrice(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const step = floorStep(price);
  return Math.max(step, Math.round(price / step) * step);
}

export type RepriceSuggestion = {
  /** Suggested new price (median sold price of the comparables, rounded); null = no reprice. */
  price: number | null;
  low: number;
  high: number;
  count: number;
};

/**
 * Suggested price from comparable SOLD items (same category, overlapping facets). Needs at least
 * MIN_COMPARABLES; the rounded median must be ≥ 5% below the current price and not below the
 * purchase price (a loss is the dealer's call, not a one-click suggestion). Returns the comparables'
 * range even when no reprice is suggested, or null without enough comparables.
 */
export function suggestReprice(input: { price: number; purchasePrice: number | null; comparables: readonly number[] }): RepriceSuggestion | null {
  const prices = input.comparables.filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length < MIN_COMPARABLES) return null;
  const mid = median(prices)!;
  const rounded = roundPrice(mid);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const worthIt = rounded > 0 && rounded <= input.price * (1 - MIN_REPRICE_DROP);
  const aboveCost = input.purchasePrice == null || rounded >= input.purchasePrice;
  return { price: worthIt && aboveCost ? rounded : null, low, high, count: prices.length };
}

// ─── Why is it sitting? ─────────────────────────────────────────────────────

export type StaleReason = "comparables" | "price" | "findability" | "slowCategory" | "unclear";

/** Total views from which "many views, no buyer" applies… */
export const MANY_VIEWS = 40;
/** …and views per 30 listed days below which an item is "hardly found". */
export const FEW_VIEWS_PER_30D = 3;
/** A category is slow when its median days-to-sell is this many times the shop median. */
export const SLOW_CATEGORY_FACTOR = 1.5;

export type StaleSignals = {
  /** Product page views (null when the shop records no page views, e.g. Matomo). */
  views: number | null;
  /** Days the views were counted over (listing age, capped at the page-view retention). */
  viewDays: number;
  /** Wishlists + saved-search alerts for this item. */
  interest: number;
  categoryMedianDays: number | null;
  shopMedianDays: number | null;
  reprice: RepriceSuggestion | null;
};

/**
 * Most likely reason an item has not sold, in order of evidence:
 *  1. comparables sold for clearly less → price (with the range as proof);
 *  2. many views or people watching but no buyer → price;
 *  3. few views for its age → hard to find;
 *  4. its category sells slowly in this shop → slow category;
 *  5. otherwise unclear.
 */
export function staleReason(s: StaleSignals): StaleReason {
  if (s.reprice?.price != null) return "comparables";
  if ((s.views != null && s.views >= MANY_VIEWS) || s.interest > 0) return "price";
  if (s.views != null && (s.views / Math.max(1, s.viewDays)) * 30 < FEW_VIEWS_PER_30D) return "findability";
  if (s.categoryMedianDays != null && s.shopMedianDays != null && s.shopMedianDays > 0 && s.categoryMedianDays >= s.shopMedianDays * SLOW_CATEGORY_FACTOR) {
    return "slowCategory";
  }
  return "unclear";
}

// ─── Buy more of these ──────────────────────────────────────────────────────

export type SalesGroup = {
  key: string;
  label: string;
  sold: number;
  medianDays: number | null;
  marginPct: number | null;
  inStock: number;
};

export type Baseline = { medianDays: number | null; marginPct: number | null };

export const BUY_MORE_MIN_SOLD = 3;
const FALLBACK_FAST_DAYS = 60;
const FALLBACK_GOOD_MARGIN = 25;

/** Little stock left compared with what sold in the period. */
export function lowStock(sold: number, inStock: number): boolean {
  return inStock <= Math.max(2, Math.floor(sold / 3));
}

/**
 * Groups that sold at least BUY_MORE_MIN_SOLD items, faster than the shop median, at a margin at
 * least the shop margin (when purchase prices are known), and have little stock left. Ranked by
 * sales speed (sold / median days), weighted by margin and penalised by remaining stock.
 */
export function pickBuyMore<G extends SalesGroup>(groups: readonly G[], baseline: Baseline, limit = 5): G[] {
  const fast = baseline.medianDays ?? FALLBACK_FAST_DAYS;
  const good = baseline.marginPct ?? FALLBACK_GOOD_MARGIN;
  const score = (g: G) => (g.sold / Math.max(1, g.medianDays ?? fast)) * (1 + Math.max(0, g.marginPct ?? 0) / 100) / (1 + g.inStock);
  return groups
    .filter(
      (g) =>
        g.sold >= BUY_MORE_MIN_SOLD &&
        g.medianDays != null &&
        g.medianDays <= fast &&
        (g.marginPct == null ? baseline.marginPct == null : g.marginPct >= good) &&
        lowStock(g.sold, g.inStock),
    )
    .sort((a, b) => score(b) - score(a) || b.sold - a.sold || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// ─── Search query stats ─────────────────────────────────────────────────────

export const SEARCH_QUERY_MAX = 120;
const MIN_QUERY_LENGTH = 2;
/** "50160", "No. 50160", "#50160": a stock number lookup, not a demand signal. */
const STOCK_NUMBER = /^(?:no\.?\s*|nr\.?\s*|#)?\d{1,9}$/i;

/**
 * Normalised form of a shop search for the daily aggregate: Unicode NFC, lower-case, trimmed,
 * whitespace collapsed, at most 120 characters. Null when the search should not be counted
 * (empty, shorter than 2 characters, or a stock number).
 */
export function normaliseSearchQuery(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  if (q.length < MIN_QUERY_LENGTH) return null;
  if (STOCK_NUMBER.test(q)) return null;
  return q.slice(0, SEARCH_QUERY_MAX).trim();
}

// ─── Category headline ──────────────────────────────────────────────────────

export type CategoryHeadline = { fast: string; slow: string; ratio: number; margin: "higher" | "lower" | null };

/**
 * One sentence under the category table: the fastest vs the slowest category (each with at least
 * BUY_MORE_MIN_SOLD sales), only when the fast one sells at least 1.5× as fast. Ratio has one decimal.
 */
export function categoryHeadline(rows: readonly { title: string; sold: number; medianDays: number | null; marginPct: number | null }[]): CategoryHeadline | null {
  const eligible = rows.filter((r) => r.sold >= BUY_MORE_MIN_SOLD && r.medianDays != null && r.medianDays > 0);
  if (eligible.length < 2) return null;
  const sorted = [...eligible].sort((a, b) => a.medianDays! - b.medianDays!);
  const fast = sorted[0];
  const slow = sorted[sorted.length - 1];
  const ratio = Math.round((slow.medianDays! / fast.medianDays!) * 10) / 10;
  if (ratio < 1.5) return null;
  const margin = fast.marginPct == null || slow.marginPct == null || fast.marginPct === slow.marginPct ? null : fast.marginPct > slow.marginPct ? "higher" : "lower";
  return { fast: fast.title, slow: slow.title, ratio, margin };
}
