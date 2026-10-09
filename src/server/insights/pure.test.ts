import { describe, expect, it } from "vitest";
import {
  categoryHeadline,
  daysBetween,
  localDay,
  marginPct,
  median,
  normaliseSearchQuery,
  parseInsightPeriod,
  parseStaleDays,
  periodBounds,
  pickBuyMore,
  roundPrice,
  sellThrough,
  staleReason,
  suggestReprice,
  type SalesGroup,
  type StaleSignals,
} from "./pure";

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([Number.NaN, 7])).toBe(7);
  });
});

describe("sell-through and margin", () => {
  it("is the share of listed items that sold", () => {
    expect(sellThrough(10, 4)).toBe(0.4);
    expect(sellThrough(0, 0)).toBeNull();
    expect(sellThrough(3, 5)).toBe(1);
  });
  it("computes margin % with one decimal like the dashboard", () => {
    expect(marginPct(10000, 6000)).toBe(40);
    expect(marginPct(30000, 20000)).toBe(33.3);
    expect(marginPct(0, 0)).toBeNull();
  });
  it("counts whole days", () => {
    expect(daysBetween("2026-01-01T00:00:00Z", "2026-01-11T12:00:00Z")).toBe(10);
    expect(daysBetween("2026-01-11T00:00:00Z", "2026-01-01T00:00:00Z")).toBe(0);
  });
});

describe("periods", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  const tz = "Europe/Amsterdam";

  it("parses with defaults", () => {
    expect(parseInsightPeriod("90d")).toBe("90d");
    expect(parseInsightPeriod("bogus")).toBe("12m");
    expect(parseStaleDays("365")).toBe(365);
    expect(parseStaleDays("12")).toBe(180);
  });

  it("90 days: local midnight 89 days back, previous window of equal length", () => {
    const b = periodBounds("90d", now, tz);
    expect(b.start.toISOString()).toBe("2026-07-11T22:00:00.000Z"); // 12 July 00:00 CEST
    expect(b.prevEnd).toEqual(b.start);
    expect(b.prevStart.toISOString()).toBe("2026-04-12T22:00:00.000Z");
    expect(b.end).toEqual(now);
  });

  it("12 months and this year", () => {
    const m = periodBounds("12m", now, tz);
    expect(m.start.toISOString()).toBe("2025-10-08T22:00:00.000Z");
    expect(m.prevStart.toISOString()).toBe("2024-10-08T22:00:00.000Z");
    const y = periodBounds("ytd", now, tz);
    expect(y.start.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(y.prevStart.toISOString()).toBe("2024-12-31T23:00:00.000Z");
    expect(y.prevEnd.getTime() - y.prevStart.getTime()).toBe(now.getTime() - y.start.getTime());
  });

  it("gives the local calendar day", () => {
    expect(localDay(new Date("2026-10-09T22:30:00Z"), tz)).toBe("2026-10-10");
    expect(localDay(new Date("2026-10-09T22:30:00Z"), "UTC")).toBe("2026-10-09");
  });
});

describe("reprice", () => {
  it("rounds like the fair floor", () => {
    expect(roundPrice(28_740)).toBe(29_000); // €287.40 → €290 (step €10)
    expect(roundPrice(4_320)).toBe(4_500); // €43.20 → €45 (step €5)
    expect(roundPrice(1_240)).toBe(1_200); // €12.40 → €12
    expect(roundPrice(123_400)).toBe(125_000); // €1,234 → €1,250 (step €50)
    expect(roundPrice(0)).toBe(0);
  });

  it("needs at least three comparables", () => {
    expect(suggestReprice({ price: 34_500, purchasePrice: null, comparables: [26_000, 29_000] })).toBeNull();
  });

  it("suggests the rounded median when clearly below the price", () => {
    const s = suggestReprice({ price: 34_500, purchasePrice: 15_000, comparables: [26_000, 29_000, 28_000, 0] });
    expect(s).toEqual({ price: 28_000, low: 26_000, high: 29_000, count: 3 });
  });

  it("does not suggest a raise, a tiny cut or a price below cost", () => {
    expect(suggestReprice({ price: 20_000, purchasePrice: null, comparables: [25_000, 26_000, 27_000] })?.price).toBeNull();
    expect(suggestReprice({ price: 29_000, purchasePrice: null, comparables: [28_000, 28_000, 28_000] })?.price).toBeNull(); // only 3.4% lower
    expect(suggestReprice({ price: 40_000, purchasePrice: 30_000, comparables: [25_000, 26_000, 27_000] })?.price).toBeNull();
  });
});

describe("staleReason", () => {
  const base: StaleSignals = { views: 20, viewDays: 300, interest: 0, categoryMedianDays: 30, shopMedianDays: 30, reprice: null };

  it("prefers proof from comparables", () => {
    expect(staleReason({ ...base, views: 200, reprice: { price: 28_000, low: 26_000, high: 29_000, count: 4 } })).toBe("comparables");
  });
  it("many views or people watching → price", () => {
    expect(staleReason({ ...base, views: 96 })).toBe("price");
    expect(staleReason({ ...base, views: 5, interest: 2 })).toBe("price");
  });
  it("few views for its age → findability", () => {
    expect(staleReason({ ...base, views: 10, viewDays: 300 })).toBe("findability");
  });
  it("slow category, else unclear", () => {
    expect(staleReason({ ...base, views: 35, viewDays: 200, categoryMedianDays: 90 })).toBe("slowCategory");
    expect(staleReason({ ...base, views: 35, viewDays: 200 })).toBe("unclear");
  });
  it("without page views it skips the view-based reasons", () => {
    expect(staleReason({ ...base, views: null, categoryMedianDays: 90 })).toBe("slowCategory");
  });
});

describe("pickBuyMore", () => {
  const g = (label: string, sold: number, medianDays: number | null, marginPct: number | null, inStock: number): SalesGroup => ({ key: label, label, sold, medianDays, marginPct, inStock });

  it("keeps fast, good-margin groups with little stock, best first", () => {
    const groups = [
      g("Helmets · Germany", 9, 12, 44, 2),
      g("Badges · Netherlands", 6, 19, 39, 1),
      g("Documents", 5, 120, 30, 3), // slow
      g("Uniforms · Germany", 6, 15, 20, 1), // low margin
      g("Belts", 2, 5, 60, 0), // too few sales
      g("Helmets · USA", 8, 10, 50, 9), // plenty of stock
    ];
    expect(pickBuyMore(groups, { medianDays: 41, marginPct: 35 }).map((x) => x.label)).toEqual(["Helmets · Germany", "Badges · Netherlands"]);
  });

  it("ignores margin when the shop has no purchase prices", () => {
    expect(pickBuyMore([g("A", 4, 10, null, 0)], { medianDays: 30, marginPct: null })).toHaveLength(1);
    expect(pickBuyMore([g("A", 4, 10, null, 0)], { medianDays: 30, marginPct: 30 })).toHaveLength(0);
  });
});

describe("categoryHeadline", () => {
  it("compares the fastest and slowest category", () => {
    const rows = [
      { title: "Helmets", sold: 14, medianDays: 18, marginPct: 42 },
      { title: "Documents", sold: 3, medianDays: 121, marginPct: 24 },
      { title: "Belts", sold: 1, medianDays: 400, marginPct: 10 },
    ];
    expect(categoryHeadline(rows)).toEqual({ fast: "Helmets", slow: "Documents", ratio: 6.7, margin: "higher" });
    expect(categoryHeadline(rows.slice(0, 1))).toBeNull();
  });
});

describe("normaliseSearchQuery", () => {
  it("lower-cases, trims and collapses whitespace", () => {
    expect(normaliseSearchQuery("  M35   Stahlhelm ")).toBe("m35 stahlhelm");
  });
  it("skips empty, very short and stock-number queries", () => {
    expect(normaliseSearchQuery("")).toBeNull();
    expect(normaliseSearchQuery(" a ")).toBeNull();
    expect(normaliseSearchQuery("50160")).toBeNull();
    expect(normaliseSearchQuery("No. 50160")).toBeNull();
    expect(normaliseSearchQuery("#50160")).toBeNull();
    expect(normaliseSearchQuery(null)).toBeNull();
  });
  it("keeps model numbers with letters and caps the length at 120", () => {
    expect(normaliseSearchQuery("M1")).toBe("m1");
    expect(normaliseSearchQuery("x".repeat(300))).toHaveLength(120);
  });
});
