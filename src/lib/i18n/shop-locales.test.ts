import { describe, expect, it } from "vitest";
import {
  hreflangAlternates,
  isLocalizablePath,
  localizePath,
  localizedUrl,
  parseLocaleHeader,
  servedLocaleParam,
  servedLocales,
  splitLocalePath,
} from "./shop-locales";

describe("splitLocalePath", () => {
  it("reads the language prefix on a segment boundary", () => {
    expect(splitLocalePath("/de/shop?q=helm")).toEqual({ locale: "de", path: "/shop?q=helm", prefixed: true });
    expect(splitLocalePath("/nl")).toEqual({ locale: "nl", path: "/", prefixed: true });
    expect(splitLocalePath("/nl?x=1")).toEqual({ locale: "nl", path: "/?x=1", prefixed: true });
    expect(splitLocalePath("/en/cart")).toEqual({ locale: "en", path: "/cart", prefixed: true });
  });
  it("leaves unprefixed paths and look-alikes alone", () => {
    expect(splitLocalePath("/shop")).toEqual({ locale: "en", path: "/shop", prefixed: false });
    expect(splitLocalePath("/design-helmets")).toEqual({ locale: "en", path: "/design-helmets", prefixed: false });
    expect(splitLocalePath("/nlx/shop").prefixed).toBe(false);
    expect(splitLocalePath("/fr/shop").prefixed).toBe(false);
  });
});

describe("localizePath", () => {
  it("prefixes shop paths for nl/de and keeps English unprefixed", () => {
    expect(localizePath("/cart", "de")).toBe("/de/cart");
    expect(localizePath("/", "nl")).toBe("/nl");
    expect(localizePath("/?q=x", "nl")).toBe("/nl?q=x");
    expect(localizePath("/shop?f=a.b#top", "de")).toBe("/de/shop?f=a.b#top");
    expect(localizePath("/cart", "en")).toBe("/cart");
  });
  it("is idempotent and switches an existing prefix", () => {
    expect(localizePath("/de/cart", "de")).toBe("/de/cart");
    expect(localizePath("/nl/cart", "de")).toBe("/de/cart");
    expect(localizePath("/nl/cart", "en")).toBe("/cart");
    expect(localizePath("/de", "en")).toBe("/");
  });
  it("never touches external, protocol-relative, hash or non-shop paths", () => {
    expect(localizePath("https://example.com/x", "de")).toBe("https://example.com/x");
    expect(localizePath("//cdn.example.com/x", "de")).toBe("//cdn.example.com/x");
    expect(localizePath("#main", "de")).toBe("#main");
    expect(localizePath("mailto:a@b.nl", "de")).toBe("mailto:a@b.nl");
    for (const p of ["/admin", "/admin/login", "/api/search/suggest", "/uploads/a.jpg", "/feeds/google.xml", "/sitemap.xml", "/product/12.md", "/network"]) {
      expect(localizePath(p, "de")).toBe(p);
    }
  });
});

describe("isLocalizablePath", () => {
  it("accepts shop pages only", () => {
    expect(isLocalizablePath("/")).toBe(true);
    expect(isLocalizablePath("/product/12/helmet")).toBe(true);
    expect(isLocalizablePath("/about-us")).toBe(true);
    expect(isLocalizablePath("/admin")).toBe(false);
    expect(isLocalizablePath("/about.md")).toBe(false);
    expect(isLocalizablePath("shop")).toBe(false);
  });
});

describe("locale settings helpers", () => {
  it("parses the proxy header strictly", () => {
    expect(parseLocaleHeader("de")).toBe("de");
    expect(parseLocaleHeader("en")).toBe("en");
    expect(parseLocaleHeader("fr")).toBe("en");
    expect(parseLocaleHeader(null)).toBe("en");
  });
  it("serves English first, then enabled extras in a fixed order", () => {
    expect(servedLocales([])).toEqual(["en"]);
    expect(servedLocales(["de", "nl", "de", "fr"])).toEqual(["en", "nl", "de"]);
    expect(servedLocales(undefined)).toEqual(["en"]);
  });
  it("accepts a locale param only when the shop serves it", () => {
    expect(servedLocaleParam("de", ["en", "de"])).toBe("de");
    expect(servedLocaleParam("nl", ["en", "de"])).toBe("en");
    expect(servedLocaleParam(null, ["en", "de"])).toBe("en");
  });
});

describe("absolute URLs and hreflang", () => {
  it("builds localized absolute URLs with x-default = English", () => {
    expect(localizedUrl("https://shop.nl", "/shop", "de")).toBe("https://shop.nl/de/shop");
    expect(hreflangAlternates("https://shop.nl", "/", ["en", "nl", "de"])).toEqual({
      en: "https://shop.nl/",
      nl: "https://shop.nl/nl",
      de: "https://shop.nl/de",
      "x-default": "https://shop.nl/",
    });
  });
});
