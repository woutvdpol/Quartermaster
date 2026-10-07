import { describe, expect, it } from "vitest";
import { catalogQueryString, catalogWindow, groupFacetTokens, hasActiveFilters, parseCatalogParams, parseFacetToken, PAGE_SIZE, sortFromSetting } from "./params";
import { resolveFacetSelection } from "./facet-selection";
import { visitorCountry } from "./country";
import { parseStockCode, productHref } from "./urls";

describe("parseCatalogParams", () => {
  it("parses and sanitises the URL state", () => {
    const p = parseCatalogParams({ q: "  stahl   helm ", tag: ["ww2", "Germany", "bad slug!", "ww2"], min: "500", max: "100", sort: "price_asc", page: "3", view: "list" });
    expect(p).toEqual({ q: "stahl helm", facets: [], facetValueIds: [], tags: ["ww2", "germany"], min: 100, max: 500, sort: "price_asc", page: 3, show: null, view: "list" });
  });

  it("falls back to defaults on garbage", () => {
    const p = parseCatalogParams({ sort: "evil", page: "-1", min: "abc", view: "table", show: "5" }, "featured");
    expect(p).toMatchObject({ q: null, tags: [], min: null, max: null, sort: "featured", page: 1, show: null, view: null });
    expect(hasActiveFilters(p)).toBe(false);
  });

  it("rounds load-more counts to page multiples and caps them", () => {
    expect(parseCatalogParams({ show: "30" }).show).toBe(PAGE_SIZE * 2);
    expect(parseCatalogParams({ show: "100000" }).show).toBe(null);
    expect(catalogWindow(parseCatalogParams({ show: "48" }))).toEqual({ offset: 0, limit: 48 });
    expect(catalogWindow(parseCatalogParams({ page: "2" }))).toEqual({ offset: PAGE_SIZE, limit: PAGE_SIZE });
  });

  it("round-trips through catalogQueryString and resets paging on filter changes", () => {
    const p = parseCatalogParams({ q: "helmet", tag: ["ww2"], page: "2", sort: "price_desc" });
    expect(catalogQueryString(p)).toBe("?q=helmet&tag=ww2&sort=price_desc&page=2");
    expect(catalogQueryString(p, { tags: ["ww2", "heer"] })).toBe("?q=helmet&tag=ww2&tag=heer&sort=price_desc");
    expect(catalogQueryString(p, { page: 3 })).toBe("?q=helmet&tag=ww2&sort=price_desc&page=3");
    expect(catalogQueryString(parseCatalogParams({}))).toBe("");
    expect(parseCatalogParams(Object.fromEntries(new URLSearchParams("q=helmet&tag=ww2&sort=price_desc&page=2")))).toMatchObject({ q: "helmet", page: 2 });
  });

  it("maps the admin default sort", () => {
    expect(sortFromSetting("price_desc")).toBe("price_desc");
    expect(sortFromSetting("nonsense")).toBe("newest");
  });
});

describe("facet params", () => {
  it("parses, dedupes and serialises facet tokens", () => {
    const p = parseCatalogParams({ f: ["period.ww2", "Country.Germany", "bad", "period.ww2", "x.y.z", "country.netherlands"] });
    expect(p.facets).toEqual(["period.ww2", "country.germany", "country.netherlands"]);
    expect(hasActiveFilters(p)).toBe(true);
    expect(catalogQueryString(p)).toBe("?f=period.ww2&f=country.germany&f=country.netherlands");
    expect(catalogQueryString(p, { facets: [] })).toBe("");
    const withId = parseCatalogParams({ f: ["cmg1abcdefghijklmnopqrstu", "period.ww2"] });
    expect(withId).toMatchObject({ facets: ["period.ww2"], facetValueIds: ["cmg1abcdefghijklmnopqrstu"] });
    expect(catalogQueryString(withId)).toBe("?f=period.ww2&f=cmg1abcdefghijklmnopqrstu");
    expect(parseFacetToken("branch.air-force")).toEqual({ facet: "branch", value: "air-force" });
    expect(parseFacetToken("branch")).toBeNull();
    expect([...groupFacetTokens(p.facets)]).toEqual([
      ["period", ["ww2"]],
      ["country", ["germany", "netherlands"]],
    ]);
  });

  it("resolves tokens against the taxonomy, expanding descendants", () => {
    const tax = {
      facets: [
        { id: "F1", kind: "BRANCH", name: "Branch", slug: "branch", sortOrder: 0, isFilterable: true },
        { id: "F2", kind: "PERIOD", name: "Period", slug: "period", sortOrder: 1, isFilterable: true },
      ],
      values: [
        { id: "army", facetId: "F1", parentId: null, name: "Army", slug: "army", sortOrder: 0 },
        { id: "heer", facetId: "F1", parentId: "army", name: "Heer", slug: "heer", sortOrder: 0 },
        { id: "ww2", facetId: "F2", parentId: null, name: "WW2", slug: "ww2", sortOrder: 0 },
      ],
    };
    expect(resolveFacetSelection(tax, ["branch.army", "period.ww2", "period.nope", "nope.x"])).toEqual([
      { facetId: "F1", valueIds: ["army", "heer"] },
      { facetId: "F2", valueIds: ["ww2"] },
    ]);
    expect(resolveFacetSelection(tax, ["branch.heer"])).toEqual([{ facetId: "F1", valueIds: ["heer"] }]);
  });
});

describe("visitorCountry", () => {
  it("prefers cf-ipcountry, then accept-language region, then the fallback", () => {
    expect(visitorCountry({ cfIpCountry: "de", acceptLanguage: "nl-NL" })).toBe("DE");
    expect(visitorCountry({ cfIpCountry: "XX", acceptLanguage: "en, fr-BE;q=0.8" })).toBe("BE");
    expect(visitorCountry({ acceptLanguage: "en" }, "NL")).toBe("NL");
    expect(visitorCountry({})).toBe("NL");
  });
});

describe("urls", () => {
  it("parses stock codes strictly", () => {
    expect(parseStockCode("50231")).toBe(50231);
    expect(parseStockCode("%2350231")).toBe(50231);
    expect(parseStockCode("50x")).toBeNull();
    expect(parseStockCode("1234567890")).toBeNull();
    expect(productHref({ stockCode: 5, slug: "a-b" })).toBe("/product/5/a-b");
  });
});
