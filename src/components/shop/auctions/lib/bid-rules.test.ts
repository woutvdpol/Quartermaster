import { describe, expect, it } from "vitest";
import { needsConfirm, quickBids, stepFor } from "./bid-rules";

describe("stepFor", () => {
  it("follows the default table", () => {
    expect(stepFor(5_000)).toBe(500);
    expect(stepFor(10_000)).toBe(1_000);
    expect(stepFor(49_000)).toBe(1_000);
    expect(stepFor(50_000)).toBe(2_500);
    expect(stepFor(100_000)).toBe(5_000);
    expect(stepFor(1_000_000)).toBe(5_000);
  });
  it("uses a shop table", () => {
    expect(stepFor(20_000, [{ upTo: null, step: 100 }])).toBe(100);
  });
});

describe("quickBids", () => {
  it("next minimum and two steps above", () => {
    expect(quickBids({ nextMinimum: 145_000 })).toEqual([145_000, 150_000, 155_000]);
    expect(quickBids({ nextMinimum: 9_500 })).toEqual([9_500, 10_000, 11_000]);
  });
});

describe("needsConfirm", () => {
  it("asks from €1,000", () => {
    expect(needsConfirm(99_900, { currentBid: 90_000, startPrice: 1 })).toBe(false);
    expect(needsConfirm(100_000, { currentBid: 90_000, startPrice: 1 })).toBe(true);
  });
  it("asks from twice the current price (start price before the first bid)", () => {
    expect(needsConfirm(19_900, { currentBid: 10_000, startPrice: 1 })).toBe(false);
    expect(needsConfirm(20_000, { currentBid: 10_000, startPrice: 1 })).toBe(true);
    expect(needsConfirm(12_000, { currentBid: null, startPrice: 6_000 })).toBe(true);
  });
});
