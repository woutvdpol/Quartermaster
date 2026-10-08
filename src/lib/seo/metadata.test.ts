import { describe, expect, it } from "vitest";
import { largeVariantSize, productMetaDescription, productOgImage, productOgTags, shopOgDefaults } from "./metadata";
import { productFixture } from "./__tests__/fixtures";

describe("product metadata helpers", () => {
  it("prefers the SEO description, then the text, then a generated fact sentence", () => {
    expect(productMetaDescription(productFixture({ seoDescription: "Custom." }), "Shop", "EUR")).toBe("Custom.");
    expect(productMetaDescription(productFixture(), "Shop", "EUR")).toBe("Original M35 helmet with liner. Good condition.");
    expect(productMetaDescription(productFixture({ description: null }), "Shop", "EUR")).toBe(
      "German M35 helmet — German; WW2, Germany, Quist. No. 1234, €450.00, for sale at Shop.",
    );
    expect(productMetaDescription(productFixture({ description: null, status: "sold" }), "Shop", null)).toBe("German M35 helmet — German; WW2, Germany, Quist. No. 1234, sold at Shop.");
  });

  it("reports the real size of the 2000w variant", () => {
    expect(largeVariantSize({ width: 3000, height: 2000 })).toEqual({ width: 2000, height: 1333 });
    expect(largeVariantSize({ width: 1600, height: 1200 })).toEqual({ width: 1600, height: 1200 });
    expect(largeVariantSize({ width: null, height: null })).toEqual({});
  });

  it("uses the main photo as OG image, alt from the title", () => {
    expect(productOgImage(productFixture())).toEqual({ url: "/uploads/a/large.webp", width: 2000, height: 1333, alt: "German M35 helmet" });
    expect(productOgImage(productFixture({ images: [] }))).toBeNull();
  });

  it("emits og:type product and price tags only when the price is shown", () => {
    expect(productOgTags(productFixture(), "EUR", true)).toEqual({
      "og:type": "product",
      "product:retailer_item_id": "1234",
      "product:condition": "used",
      "product:availability": "in stock",
      "product:price:amount": "450.00",
      "product:price:currency": "EUR",
    });
    expect(productOgTags(productFixture({ status: "sold" }), "EUR", false)).not.toHaveProperty("product:price:amount");
  });

  it("falls back to the generated card without a banner", () => {
    expect(shopOgDefaults({ shopName: "S", settings: { appearance: { bannerPath: "/uploads/b.jpg" } } }).images).toEqual([{ url: "/uploads/b.jpg" }]);
    expect(shopOgDefaults({ shopName: "S", settings: { appearance: { bannerPath: null } } }).images[0]).toMatchObject({ url: "/og/shop", width: 1200, height: 630 });
  });
});
