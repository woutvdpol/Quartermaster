import { describe, expect, it } from "vitest";
import { isBiddable, lotChip } from "./status";

const now = Date.parse("2026-11-09T19:00:00Z");
const open = { status: "OPEN" as const, closesAt: "2026-11-09T20:00:00Z", leaderNumber: 12 };

describe("lotChip", () => {
  it("open lot without the viewer", () => {
    expect(lotChip(open, null, now)).toBe("open");
    expect(lotChip(open, { bidderNumber: null, hasBid: false }, now)).toBe("open");
  });
  it("you lead / outbid", () => {
    expect(lotChip(open, { bidderNumber: 12, hasBid: true }, now)).toBe("lead");
    expect(lotChip(open, { bidderNumber: 7, hasBid: true }, now)).toBe("outbid");
    expect(lotChip(open, { bidderNumber: 7, hasBid: false }, now)).toBe("open");
  });
  it("final states", () => {
    expect(lotChip({ ...open, status: "SOLD" }, null, now)).toBe("sold");
    expect(lotChip({ ...open, status: "SOLD" }, { bidderNumber: 12, hasBid: true }, now)).toBe("won");
    expect(lotChip({ ...open, status: "UNSOLD" }, { bidderNumber: 12, hasBid: true }, now)).toBe("unsold");
    expect(lotChip({ ...open, status: "CANCELLED" }, null, now)).toBe("cancelled");
  });
  it("past closesAt but not processed yet: closing", () => {
    expect(lotChip(open, { bidderNumber: 12, hasBid: true }, Date.parse(open.closesAt))).toBe("closing");
  });
  it("auction not open yet: upcoming", () => {
    expect(lotChip(open, null, now, "2026-11-09T19:30:00Z")).toBe("upcoming");
    expect(lotChip(open, null, now, "2026-11-09T18:30:00Z")).toBe("open");
  });
});

describe("isBiddable", () => {
  it("only open lots before closesAt and after opening", () => {
    expect(isBiddable(open, now)).toBe(true);
    expect(isBiddable(open, Date.parse(open.closesAt))).toBe(false);
    expect(isBiddable({ ...open, status: "SOLD" }, now)).toBe(false);
    expect(isBiddable(open, now, "2026-11-09T19:30:00Z")).toBe(false);
  });
});
