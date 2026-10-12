import { describe, expect, it } from "vitest";
import { EMPTY_TRACKER, addOffsetSample, countdownParts, countdownUrgency, formatCountdown, offsetSample, remainingMs } from "./clock";

describe("offsetSample", () => {
  it("is server minus local at receipt", () => {
    expect(offsetSample(10_000, 7_000)).toBe(3_000);
    expect(offsetSample(new Date(10_000).toISOString(), 12_000)).toBe(-2_000);
  });
  it("uses the round-trip midpoint for request/response pairs", () => {
    expect(offsetSample(10_000, 7_400, 7_000)).toBe(2_800);
  });
  it("ignores unreadable server times", () => {
    expect(offsetSample("nope", 1)).toBeNull();
  });
});

describe("addOffsetSample", () => {
  it("keeps the largest recent sample (least transit delay)", () => {
    let t = EMPTY_TRACKER;
    for (const s of [1_000, 1_200, 900, 1_150]) t = addOffsetSample(t, s);
    expect(t.offset).toBe(1_200);
  });
  it("forgets old samples beyond the window", () => {
    let t = addOffsetSample(EMPTY_TRACKER, 1_500);
    for (let i = 0; i < 8; i++) t = addOffsetSample(t, 1_000);
    expect(t.offset).toBe(1_000);
  });
  it("starts over when the device clock jumps", () => {
    let t = addOffsetSample(EMPTY_TRACKER, 1_000);
    t = addOffsetSample(t, -3_600_000);
    expect(t.offset).toBe(-3_600_000);
    expect(t.samples).toEqual([-3_600_000]);
  });
  it("null samples change nothing", () => {
    const t = addOffsetSample(EMPTY_TRACKER, 5);
    expect(addOffsetSample(t, null)).toBe(t);
  });
});

describe("remainingMs", () => {
  it("counts down on the server clock, not the device clock", () => {
    // Device is 1 minute behind the server: 2 minutes left on the server = 1 minute by the device.
    const closes = new Date(Date.UTC(2026, 10, 9, 20, 0, 0)).toISOString();
    const serverNow = Date.parse(closes) - 60_000;
    const deviceNow = serverNow - 60_000;
    expect(remainingMs(closes, deviceNow, 60_000)).toBe(60_000);
  });
});

describe("formatCountdown", () => {
  it.each([
    [0, "00:00"],
    [-5_000, "00:00"],
    [400, "00:01"],
    [372_000, "06:12"],
    [2_538_000, "42:18"],
    [6_138_000, "01:42:18"],
    [2 * 86_400_000 + 4 * 3_600_000 + 12 * 60_000, "2d 04:12"],
  ])("%d ms → %s", (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
  it("takes the day unit of the language", () => {
    expect(formatCountdown(86_400_000 + 1_000, "T")).toBe("1T 00:00");
  });
  it("splits into parts", () => {
    expect(countdownParts(3_661_000)).toEqual({ days: 0, hours: 1, minutes: 1, seconds: 1, done: false });
  });
});

describe("countdownUrgency", () => {
  it("marks the extension window as final", () => {
    expect(countdownUrgency(0)).toBe("done");
    expect(countdownUrgency(119_000)).toBe("final");
    expect(countdownUrgency(300_000)).toBe("soon");
    expect(countdownUrgency(3_600_000)).toBe("normal");
  });
});
