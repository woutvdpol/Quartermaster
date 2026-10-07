import { describe, expect, it } from "vitest";
import { pageWindow } from "./Pagination";
import { formatIndicative, formatMoney } from "./money";

describe("pageWindow", () => {
  it("shows all pages when few", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(2, 4)).toEqual([1, 2, 3, 4]);
  });
  it("collapses gaps with ellipses", () => {
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageWindow(10, 10)).toEqual([1, null, 9, 10]);
    expect(pageWindow(3, 10)).toEqual([1, 2, 3, 4, null, 10]);
  });
});

describe("money", () => {
  it("formats minor units", () => {
    expect(formatMoney(145000, "EUR")).toBe("€1,450.00");
    expect(formatMoney(1500, "JPY")).toBe("JP¥1,500");
  });
  it("formats indicative conversions and ignores bad rates", () => {
    expect(formatIndicative(145000, "EUR", "GBP", 0.87)).toBe("£1,262");
    expect(formatIndicative(145000, "EUR", "GBP", 0)).toBeNull();
    expect(formatIndicative(145000, "EUR", "GBP", Number.NaN)).toBeNull();
  });
});
