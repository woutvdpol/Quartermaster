import { describe, expect, it } from "vitest";
import { digestSlotDue, lastDigestSlot, zonedTime } from "./schedule";

const AMS = "Europe/Amsterdam";

describe("digest schedule", () => {
  it("zonedTime converts local wall clock to UTC (summer and winter)", () => {
    expect(zonedTime(2026, 7, 1, 7, AMS).toISOString()).toBe("2026-07-01T05:00:00.000Z");
    expect(zonedTime(2026, 1, 15, 7, AMS).toISOString()).toBe("2026-01-15T06:00:00.000Z");
    expect(zonedTime(2026, 1, 15, 7, "UTC").toISOString()).toBe("2026-01-15T07:00:00.000Z");
  });

  it("daily slot = today 07:00 local after 07:00, else yesterday", () => {
    // 2026-10-07 is a Wednesday; Amsterdam = UTC+2.
    expect(lastDigestSlot("DAILY", new Date("2026-10-07T05:30:00Z"), AMS)?.toISOString()).toBe("2026-10-07T05:00:00.000Z");
    expect(lastDigestSlot("DAILY", new Date("2026-10-07T04:59:00Z"), AMS)?.toISOString()).toBe("2026-10-06T05:00:00.000Z");
    expect(lastDigestSlot("INSTANT", new Date(), AMS)).toBeNull();
  });

  it("weekly slot = most recent Monday 07:00 local", () => {
    expect(lastDigestSlot("WEEKLY", new Date("2026-10-07T12:00:00Z"), AMS)?.toISOString()).toBe("2026-10-05T05:00:00.000Z");
    // Monday before 07:00 → previous Monday.
    expect(lastDigestSlot("WEEKLY", new Date("2026-10-05T04:00:00Z"), AMS)?.toISOString()).toBe("2026-09-28T05:00:00.000Z");
  });

  it("due once per slot", () => {
    const now = new Date("2026-10-07T05:10:00Z");
    expect(digestSlotDue("DAILY", now, AMS, null)?.toISOString()).toBe("2026-10-07T05:00:00.000Z");
    expect(digestSlotDue("DAILY", now, AMS, new Date("2026-10-06T05:05:00Z"))).not.toBeNull();
    expect(digestSlotDue("DAILY", now, AMS, new Date("2026-10-07T05:05:00Z"))).toBeNull();
  });

  it("an invalid time zone falls back to UTC", () => {
    expect(lastDigestSlot("DAILY", new Date("2026-10-07T08:00:00Z"), "Not/AZone")?.toISOString()).toBe("2026-10-07T07:00:00.000Z");
  });
});
