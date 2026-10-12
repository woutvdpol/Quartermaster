import { describe, expect, it } from "vitest";
import { formatBidMoney, formatMoneyInput, parseMoneyInput } from "./money";

describe("parseMoneyInput", () => {
  it.each([
    ["1450", 145_000],
    ["1.450", 145_000],
    ["1,450", 145_000],
    ["1.450,50", 145_050],
    ["1,450.50", 145_050],
    ["1450,5", 145_050],
    ["1450.05", 145_005],
    ["€ 1.450", 145_000],
    ["€1,450.00", 145_000],
    ["1.450,00 €", 145_000],
    ["EUR 85", 8_500],
    ["1 450", 145_000],
    ["1 450,00", 145_000],
    ["1450,-", 145_000],
    ["1450.", 145_000],
    ["1.000.000", 100_000_000],
    ["  85  ", 8_500],
  ])("%s → %d", (raw, minor) => {
    expect(parseMoneyInput(raw)).toBe(minor);
  });

  it.each(["", "abc", "0", "0,00", "-5", "1.4.50", "1,450,50", "1450.123", "1.45.000", "1.450.5,00", ",50x", "1.000,000.00"])("rejects %j", (raw) => {
    expect(parseMoneyInput(raw)).toBeNull();
  });

  it("rejects absurd amounts", () => {
    expect(parseMoneyInput("99999999999")).toBeNull();
  });

  it("zero-decimal currencies: separators group, decimals must be zero", () => {
    expect(parseMoneyInput("1,450", "JPY")).toBe(1450);
    expect(parseMoneyInput("1450,5", "JPY")).toBeNull();
  });
});

describe("formatMoneyInput", () => {
  it("formats in the page language without a symbol", () => {
    expect(formatMoneyInput(145_000, "en")).toBe("1,450");
    expect(formatMoneyInput(145_000, "nl")).toBe("1.450");
    expect(formatMoneyInput(145_000, "de")).toBe("1.450");
    expect(formatMoneyInput(145_050, "de")).toBe("1.450,50");
  });

  it("round-trips through the parser", () => {
    for (const locale of ["en", "nl", "de"] as const) {
      for (const minor of [500, 9_950, 145_000, 145_050, 12_345_600]) {
        expect(parseMoneyInput(formatMoneyInput(minor, locale))).toBe(minor);
      }
    }
  });
});

describe("formatBidMoney", () => {
  const plain = (s: string) => s.replace(/[  ]/g, " ");
  it("drops .00 for whole amounts, per language", () => {
    expect(plain(formatBidMoney(145_000, "EUR", "en"))).toBe("€1,450");
    expect(plain(formatBidMoney(145_000, "EUR", "nl"))).toBe("€ 1.450");
    expect(plain(formatBidMoney(145_000, "EUR", "de"))).toBe("1.450 €");
    expect(plain(formatBidMoney(145_050, "EUR", "en"))).toBe("€1,450.50");
  });
});
