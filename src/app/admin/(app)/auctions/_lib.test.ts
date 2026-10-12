import { describe, expect, it } from "vitest";
import {
  buildCsv,
  csvAmount,
  csvCell,
  filterCounts,
  formatPercent,
  formatSeconds,
  lotPricesEditable,
  matchesFilter,
  parseResultFilter,
  parseSchedule,
  resultKind,
  suggestSchedule,
  vsList,
  type ScheduleFields,
} from "./_lib";

const TZ = "Europe/Amsterdam";
const NOW = new Date("2026-10-12T10:00:00Z");
const base: ScheduleFields = {
  type: "DAY",
  title: "Autumn Auction 2026",
  opensAt: "2026-11-01T10:00",
  firstCloseAt: "2026-11-09T20:00",
  gapSeconds: "1",
  extendSeconds: "2",
  payDays: "5",
};

describe("parseSchedule", () => {
  it("converts shop-local datetime-local values to UTC and minutes to seconds", () => {
    const r = parseSchedule(base, TZ, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // November: CET (UTC+1)
    expect(r.input.opensAt.toISOString()).toBe("2026-11-01T09:00:00.000Z");
    expect(r.input.firstCloseAt.toISOString()).toBe("2026-11-09T19:00:00.000Z");
    expect(r.input).toMatchObject({ type: "DAY", title: "Autumn Auction 2026", gapSeconds: 60, extendSeconds: 120, payDays: 5 });
  });

  it("handles summer time", () => {
    const r = parseSchedule({ ...base, opensAt: "2027-07-01T12:00", firstCloseAt: "2027-07-02T12:00" }, TZ, NOW);
    expect(r.ok && r.input.opensAt.toISOString()).toBe("2027-07-01T10:00:00.000Z");
  });

  it("rejects a close before the opening and in the past", () => {
    const r = parseSchedule({ ...base, firstCloseAt: "2026-10-31T10:00" }, TZ, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.firstCloseAt).toEqual(["Must be after the opening time."]);
    const past = parseSchedule({ ...base, opensAt: "2026-10-01T10:00", firstCloseAt: "2026-10-02T10:00" }, TZ, NOW);
    expect(!past.ok && past.errors.firstCloseAt).toEqual(["Must be in the future."]);
  });

  it("requires title, dates and sane numbers", () => {
    const r = parseSchedule({ ...base, title: " ", opensAt: "", gapSeconds: "x", extendSeconds: "99", payDays: "0" }, TZ, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["extendSeconds", "gapSeconds", "opensAt", "payDays", "title"]);
  });

  it("lets a single lot leave the gap empty", () => {
    const r = parseSchedule({ ...base, type: "SINGLE", gapSeconds: "" }, TZ, NOW);
    expect(r.ok && r.input.gapSeconds).toBe(0);
  });
});

describe("formatting", () => {
  it("formats seconds and percentages", () => {
    expect(formatSeconds(60)).toBe("1 min");
    expect(formatSeconds(120)).toBe("2 min");
    expect(formatSeconds(90)).toBe("90 s");
    expect(formatSeconds(0)).toBe("none");
    expect(formatPercent(0.084)).toBe("+8%");
    expect(formatPercent(-0.12)).toBe("-12%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("lot prices", () => {
  it("are editable until the first bid", () => {
    expect(lotPricesEditable("DRAFT", { status: "OPEN", bidCount: 0 })).toBe(true);
    expect(lotPricesEditable("LIVE", { status: "OPEN", bidCount: 0 })).toBe(true);
    expect(lotPricesEditable("LIVE", { status: "OPEN", bidCount: 1 })).toBe(false);
    expect(lotPricesEditable("CLOSED", { status: "UNSOLD", bidCount: 0 })).toBe(false);
  });
});

describe("results", () => {
  const kinds = [
    resultKind({ lotStatus: "SOLD", paid: true, daysSinceClose: 9 }, 5),
    resultKind({ lotStatus: "SOLD", paid: false, daysSinceClose: 2 }, 5),
    resultKind({ lotStatus: "SOLD", paid: false, daysSinceClose: 6 }, 5),
    resultKind({ lotStatus: "UNSOLD", paid: false, daysSinceClose: 1 }, 5),
    resultKind({ lotStatus: "CANCELLED", paid: false, daysSinceClose: 8 }, 5),
    resultKind({ lotStatus: "OPEN", paid: false, daysSinceClose: null }, 5),
  ];

  it("classifies lots", () => {
    expect(kinds).toEqual(["paid", "awaiting", "overdue", "unsold", "cancelled", "open"]);
    // exactly on the last pay day is not overdue yet
    expect(resultKind({ lotStatus: "SOLD", paid: false, daysSinceClose: 5 }, 5)).toBe("awaiting");
  });

  it("filters and counts", () => {
    expect(kinds.filter((k) => matchesFilter(k, "awaiting"))).toEqual(["awaiting", "overdue"]);
    expect(kinds.filter((k) => matchesFilter(k, "overdue"))).toEqual(["overdue"]);
    expect(kinds.filter((k) => matchesFilter(k, "unsold"))).toEqual(["unsold", "cancelled"]);
    expect(kinds.filter((k) => matchesFilter(k, null))).toHaveLength(6);
    expect(filterCounts(kinds)).toEqual({ all: 6, awaiting: 2, overdue: 1, unsold: 2 });
  });

  it("parses the filter param", () => {
    expect(parseResultFilter("overdue")).toBe("overdue");
    expect(parseResultFilter("paid")).toBeNull();
    expect(parseResultFilter(undefined)).toBeNull();
  });

  it("compares the hammer total with list prices", () => {
    expect(vsList([{ hammer: 10800, listPrice: 10000 }])).toBeCloseTo(0.08);
    expect(vsList([])).toBeNull();
  });
});

describe("csv", () => {
  it("quotes and neutralizes formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell(null)).toBe("");
    expect(csvCell(-5)).toBe("-5");
    expect(csvAmount(123456)).toBe("1234.56");
    expect(csvAmount(null)).toBe("");
  });

  it("builds CRLF rows with a header", () => {
    expect(buildCsv(["a", "b"], [[1, "x"], [null, "y,z"]])).toBe('a,b\r\n1,x\r\n,"y,z"\r\n');
  });
});

describe("suggestSchedule", () => {
  it("suggests tomorrow 10:00 and a week later 20:00 in the shop zone", () => {
    // 23:30 UTC on the 12th is already the 13th in Amsterdam
    expect(suggestSchedule(new Date("2026-10-12T23:30:00Z"), TZ)).toEqual({ opensAt: "2026-10-14T10:00", firstCloseAt: "2026-10-21T20:00" });
  });
});
