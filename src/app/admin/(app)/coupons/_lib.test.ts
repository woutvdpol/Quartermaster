import { describe, expect, it } from "vitest";
import { dateToLocalInput, localInputToDate } from "./_lib";

describe("coupon form dates", () => {
  it("round-trips local times in the shop zone, across DST", () => {
    expect(localInputToDate("2026-07-01T12:00", "Europe/Amsterdam")!.toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(localInputToDate("2026-01-01T12:00", "Europe/Amsterdam")!.toISOString()).toBe("2026-01-01T11:00:00.000Z");
    expect(dateToLocalInput(new Date("2026-07-01T10:00:00Z"), "Europe/Amsterdam")).toBe("2026-07-01T12:00");
    expect(localInputToDate("", "Europe/Amsterdam")).toBeNull();
  });
});
