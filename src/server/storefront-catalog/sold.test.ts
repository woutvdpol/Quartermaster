import { describe, expect, it } from "vitest";
import { toCardData } from "@/components/shop/catalog/to-card";
import type { CatalogCard } from "./types";
import { inSoldArchive, priceVisible, soldLabel, soldMonth, soldPageNoindex } from "./sold";
import { archiveCategoryHref } from "./urls";

const card = (over: Partial<CatalogCard> = {}): CatalogCard => ({
  id: "p1",
  stockCode: 50160,
  slug: "stahlhelm-m40",
  href: "/product/50160/stahlhelm-m40",
  title: "Stahlhelm M40 Heer, ET64",
  price: 135000,
  status: "sold",
  onSale: false,
  blurred: false,
  showSoldPrice: false,
  publishedAt: "2026-01-02T10:00:00.000Z",
  soldAt: "2026-10-03T10:00:00.000Z",
  category: { title: "Steel helmets", slug: "steel-helmets" },
  cover: null,
  ...over,
});

describe("sold archive rules", () => {
  it("shows the price of live items always, of sold items only when ticked per item", () => {
    expect(priceVisible({ status: "available", showSoldPrice: false })).toBe(true);
    expect(priceVisible({ status: "reserved", showSoldPrice: false })).toBe(true);
    expect(priceVisible({ status: "sold", showSoldPrice: false })).toBe(false);
    expect(priceVisible({ status: "sold", showSoldPrice: true })).toBe(true);
    // Prisma enum spelling works too.
    expect(priceVisible({ status: "SOLD", showSoldPrice: false })).toBe(false);
    expect(priceVisible({ status: "ACTIVE", showSoldPrice: false })).toBe(true);
  });

  it("lists sold items in the archive unless hidden per item or the archive is off", () => {
    expect(inSoldArchive({ status: "sold", archiveHidden: false }, true)).toBe(true);
    expect(inSoldArchive({ status: "sold", archiveHidden: true }, true)).toBe(false);
    expect(inSoldArchive({ status: "sold", archiveHidden: false }, false)).toBe(false);
    expect(inSoldArchive({ status: "available", archiveHidden: false }, true)).toBe(false);
  });

  it("indexes sold pages only as part of the archive, sensitive items never", () => {
    const sold = { status: "sold", archiveHidden: false, blurred: false };
    expect(soldPageNoindex(sold, true)).toBe(false);
    expect(soldPageNoindex(sold, false)).toBe(true);
    expect(soldPageNoindex({ ...sold, archiveHidden: true }, true)).toBe(true);
    expect(soldPageNoindex({ ...sold, blurred: true }, true)).toBe(true);
    expect(soldPageNoindex({ status: "available", archiveHidden: true, blurred: false }, false)).toBe(false);
  });

  it("formats the month of sale", () => {
    expect(soldMonth("2026-10-03T10:00:00.000Z")).toBe("Oct 2026");
    // Shop time zone: 31 Oct 23:30 UTC is already November in Amsterdam.
    expect(soldMonth("2026-10-31T23:30:00.000Z", "Europe/Amsterdam")).toBe("Nov 2026");
    expect(soldMonth("2026-10-31T23:30:00.000Z", "Not/AZone")).toBe("Oct 2026");
    expect(soldMonth(null)).toBeNull();
    expect(soldMonth("garbage")).toBeNull();
    expect(soldLabel("2026-10-03T10:00:00.000Z")).toBe("Sold Oct 2026");
    expect(soldLabel(null)).toBe("Sold");
  });

  it("has archive category URLs", () => {
    expect(archiveCategoryHref("steel-helmets")).toBe("/archive/category/steel-helmets");
  });
});

describe("toCardData (sold items)", () => {
  const ctx = { currency: "EUR", lockSensitive: false };

  it("hides the sold price unless shown per item and labels the month", () => {
    const hidden = toCardData(card(), ctx);
    expect(hidden).toMatchObject({ availability: "sold", showPrice: false, soldLabel: "Sold Oct 2026" });
    const shown = toCardData(card({ showSoldPrice: true }), ctx);
    expect(shown).toMatchObject({ showPrice: true, priceCents: 135000, soldLabel: "Sold Oct 2026" });
  });

  it("leaves live cards alone", () => {
    const live = toCardData(card({ status: "available", soldAt: null }), ctx);
    expect(live).toMatchObject({ availability: "available", showPrice: true, soldLabel: null });
  });
});
