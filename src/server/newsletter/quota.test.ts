import { describe, expect, it } from "vitest";
import { checkQuota, monthWindow, timeZoneOffsetMs } from "./quota";

describe("checkQuota", () => {
  it("treats -1 as unlimited", () => {
    expect(checkQuota({ quota: -1, used: 1_000_000, needed: 5000 })).toMatchObject({ ok: true, unlimited: true, remaining: null });
  });

  it("allows sends that fit and reports what remains", () => {
    expect(checkQuota({ quota: 1000, used: 400, needed: 600 })).toEqual({ ok: true, unlimited: false, quota: 1000, used: 400, remaining: 0 });
    expect(checkQuota({ quota: 1000, used: 0, needed: 1 })).toMatchObject({ ok: true, remaining: 999 });
  });

  it("refuses sends that exceed the remaining quota (all-or-nothing)", () => {
    expect(checkQuota({ quota: 1000, used: 400, needed: 601 })).toEqual({ ok: false, quota: 1000, used: 400, remaining: 600, needed: 601 });
    expect(checkQuota({ quota: 0, used: 0, needed: 1 })).toMatchObject({ ok: false, remaining: 0 });
    // Over-used (quota lowered after sending) never goes negative.
    expect(checkQuota({ quota: 100, used: 150, needed: 1 })).toMatchObject({ ok: false, remaining: 0 });
  });
});

describe("monthWindow", () => {
  it("uses the tenant's local calendar month", () => {
    // 31 Jan 23:30 UTC is already 1 Feb in Amsterdam (UTC+1).
    const w = monthWindow(new Date("2026-01-31T23:30:00Z"), "Europe/Amsterdam");
    expect(w.start.toISOString()).toBe("2026-01-31T23:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-02-28T23:00:00.000Z");
  });

  it("handles DST changes inside the month", () => {
    const w = monthWindow(new Date("2026-03-15T12:00:00Z"), "Europe/Amsterdam");
    expect(w.start.toISOString()).toBe("2026-02-28T23:00:00.000Z"); // CET
    expect(w.end.toISOString()).toBe("2026-03-31T22:00:00.000Z"); // CEST
  });

  it("works in UTC and across the year boundary", () => {
    const w = monthWindow(new Date("2026-12-10T00:00:00Z"), "UTC");
    expect(w.start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("computes offsets", () => {
    expect(timeZoneOffsetMs(new Date("2026-07-01T00:00:00Z"), "Europe/Amsterdam")).toBe(2 * 3600_000);
    expect(timeZoneOffsetMs(new Date("2026-07-01T00:00:00Z"), "America/New_York")).toBe(-4 * 3600_000);
  });
});
