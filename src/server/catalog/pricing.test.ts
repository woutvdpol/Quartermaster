import { describe, expect, it } from "vitest";
import { adjustPriceByPercent, margin } from "./pricing";

describe("adjustPriceByPercent", () => {
  it("applies increases and decreases", () => {
    expect(adjustPriceByPercent(10000, 10)).toBe(11000);
    expect(adjustPriceByPercent(10000, -15)).toBe(8500);
    expect(adjustPriceByPercent(10000, 0)).toBe(10000);
  });
  it("rounds to whole cents, half up, without float drift", () => {
    expect(adjustPriceByPercent(1999, 10)).toBe(2199); // 2198.9
    expect(adjustPriceByPercent(5, 10)).toBe(6); // 5.5 → 6
    expect(adjustPriceByPercent(15, -10)).toBe(14); // 13.5 → 14
    expect(adjustPriceByPercent(1999, 7.5)).toBe(2149); // 2148.925
    expect(adjustPriceByPercent(333, 33.33)).toBe(444); // 443.9889
  });
  it("uses at most 2 decimals of the percentage", () => {
    expect(adjustPriceByPercent(100000, 10.004)).toBe(adjustPriceByPercent(100000, 10));
  });
  it("never returns a negative price", () => {
    expect(adjustPriceByPercent(1000, -100)).toBe(0);
    expect(adjustPriceByPercent(1000, -150)).toBe(0);
  });
  it("rejects invalid prices", () => {
    expect(() => adjustPriceByPercent(-1, 10)).toThrow(RangeError);
    expect(() => adjustPriceByPercent(10.5, 10)).toThrow(RangeError);
  });
});

describe("margin", () => {
  it("is price minus purchase price, null when unknown", () => {
    expect(margin(5000, 3000)).toBe(2000);
    expect(margin(5000, null)).toBeNull();
    expect(margin(1000, 1500)).toBe(-500);
  });
});
