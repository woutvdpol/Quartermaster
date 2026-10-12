import { describe, expect, it } from "vitest";
import { backoffDelay } from "./backoff";

describe("backoffDelay", () => {
  const mid = () => 0.5; // no jitter
  it("doubles per attempt from the base", () => {
    expect([0, 1, 2, 3].map((a) => backoffDelay(a, {}, mid))).toEqual([1_000, 2_000, 4_000, 8_000]);
  });
  it("is capped", () => {
    expect(backoffDelay(10, {}, mid)).toBe(30_000);
    expect(backoffDelay(1_000, {}, mid)).toBe(30_000);
    expect(backoffDelay(10, { maxMs: 5_000 }, () => 0.999)).toBe(5_000);
  });
  it("adds bounded jitter", () => {
    expect(backoffDelay(2, {}, () => 0)).toBe(3_000);
    expect(backoffDelay(2, {}, () => 1)).toBe(5_000);
  });
  it("treats negative/fractional attempts sanely", () => {
    expect(backoffDelay(-3, {}, mid)).toBe(1_000);
    expect(backoffDelay(1.7, {}, mid)).toBe(2_000);
  });
});
