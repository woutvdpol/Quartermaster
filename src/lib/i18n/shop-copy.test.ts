import { describe, expect, it } from "vitest";
import { formatMoney, formatIndicative } from "@/components/shop/ui/money";
import { formatCount, formatShopDate, localized, pickCopy } from "./shop-copy";

/** Intl uses narrow/no-break spaces; compare with plain spaces. */
const plain = (s: string | null) => s?.replace(/[  ]/g, " ");

describe("money per shop language", () => {
  it("formats EUR the local way", () => {
    expect(plain(formatMoney(145000, "EUR"))).toBe("€1,450.00");
    expect(plain(formatMoney(145000, "EUR", "en"))).toBe("€1,450.00");
    expect(plain(formatMoney(145000, "EUR", "nl"))).toBe("€ 1.450,00");
    expect(plain(formatMoney(145000, "EUR", "de"))).toBe("1.450,00 €");
  });
  it("formats indicative conversions per language", () => {
    expect(plain(formatIndicative(145000, "EUR", "GBP", 0.87, "de"))).toBe("1.262 £");
  });
});

describe("numbers and dates", () => {
  it("groups thousands per language", () => {
    expect(formatCount(1450, "en")).toBe("1,450");
    expect(formatCount(1450, "nl")).toBe("1.450");
    expect(formatCount(1450, "de")).toBe("1.450");
  });
  it("formats dates in the shop time zone", () => {
    const d = new Date("2026-10-09T22:30:00Z");
    expect(formatShopDate(d, "en", undefined, "Europe/Amsterdam")).toBe("10 Oct 2026");
    expect(formatShopDate(d, "nl", undefined, "Europe/Amsterdam")).toBe("10 okt 2026");
    expect(formatShopDate(d, "de", undefined, "Europe/Amsterdam")).toBe("10. Okt. 2026");
    expect(formatShopDate(new Date("2026-10-09T12:00:00Z"), "en", undefined, "Not/AZone")).toBe("9 Oct 2026");
  });
});

describe("bundles", () => {
  it("picks the requested language", () => {
    const b = localized({ en: { hi: "Hello", n: (x: number) => `${x} items` }, nl: { hi: "Hallo", n: (x: number) => `${x} stuks` }, de: { hi: "Hallo", n: (x: number) => `${x} Stück` } });
    expect(pickCopy(b, "nl").hi).toBe("Hallo");
    expect(pickCopy(b, "de").n(2)).toBe("2 Stück");
    expect(pickCopy(b, "en").hi).toBe("Hello");
  });
});
