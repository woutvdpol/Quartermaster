import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { crossRate, parseEcbDaily } from "./ecb";

const fixture = readFileSync(new URL("./__fixtures__/eurofxref-daily.xml", import.meta.url), "utf8");

describe("parseEcbDaily", () => {
  it("parses the reference date and every rate", () => {
    const daily = parseEcbDaily(fixture);
    expect(daily.date).toBe("2026-10-06");
    expect(Object.keys(daily.rates)).toHaveLength(30);
    expect(daily.rates.USD).toBe(1.1712);
    expect(daily.rates.GBP).toBe(0.86915);
    expect(daily.rates.JPY).toBe(172.45);
    expect(daily.rates.EUR).toBeUndefined();
  });

  it("accepts double quotes and attribute order variations", () => {
    const xml = `<Cube><Cube time="2026-01-02"><Cube rate="1.5" currency="AUD" /></Cube></Cube>`;
    expect(parseEcbDaily(xml)).toEqual({ date: "2026-01-02", rates: { AUD: 1.5 } });
  });

  it("rejects responses without a date or rates", () => {
    expect(() => parseEcbDaily("<html>maintenance</html>")).toThrow(/date/);
    expect(() => parseEcbDaily("<Cube time='2026-01-02'></Cube>")).toThrow(/rates/);
  });

  it("ignores malformed rate entries", () => {
    const xml = `<Cube time='2026-01-02'><Cube currency='USD' rate='abc'/><Cube currency='GBP' rate='0.9'/><Cube currency='XX' rate='1'/></Cube>`;
    expect(parseEcbDaily(xml).rates).toEqual({ GBP: 0.9 });
  });
});

describe("crossRate", () => {
  const { rates } = parseEcbDaily(fixture);
  it("converts from EUR directly", () => {
    expect(crossRate(rates, "EUR", "USD")).toBe(1.1712);
    expect(crossRate(rates, "EUR", "EUR")).toBe(1);
  });
  it("converts via EUR for other shop currencies", () => {
    expect(crossRate(rates, "GBP", "EUR")).toBeCloseTo(1 / 0.86915, 10);
    expect(crossRate(rates, "GBP", "USD")).toBeCloseTo(1.1712 / 0.86915, 10);
  });
  it("returns null for unknown currencies", () => {
    expect(crossRate(rates, "EUR", "XYZ")).toBeNull();
    expect(crossRate(rates, "XYZ", "EUR")).toBeNull();
  });
});
