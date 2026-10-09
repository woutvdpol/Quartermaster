import { describe, expect, it } from "vitest";
import type { CompiledRule } from "@/server/compliance/resolve";
import {
  facetValueIdsFor,
  isNetworkEligibleProduct,
  isNetworkEligibleTenant,
  networkExclusionFor,
  networkFacetOptions,
  networkProductWhere,
  shipsToCountry,
  type FacetValueFacts,
} from "./eligibility";
import { networkQueryString, parseNetworkParams } from "./params";

const tenant = { status: "ACTIVE", networkOptIn: true, setupState: null, setupCompletedAt: null, domains: [{ isPrimary: true }] };

describe("isNetworkEligibleTenant", () => {
  it("accepts an active, opted-in, live shop with a primary domain", () => {
    expect(isNetworkEligibleTenant(tenant)).toBe(true);
    expect(isNetworkEligibleTenant({ ...tenant, setupState: { basics: { done: true } }, setupCompletedAt: new Date() })).toBe(true);
  });
  it("rejects shops that did not opt in, are not active, not live or have no primary domain", () => {
    expect(isNetworkEligibleTenant({ ...tenant, networkOptIn: false })).toBe(false);
    expect(isNetworkEligibleTenant({ ...tenant, status: "SUSPENDED" })).toBe(false);
    expect(isNetworkEligibleTenant({ ...tenant, setupState: { basics: { done: true } } })).toBe(false); // still in the wizard
    expect(isNetworkEligibleTenant({ ...tenant, domains: [{ isPrimary: false }] })).toBe(false);
    expect(isNetworkEligibleTenant({ ...tenant, domains: [] })).toBe(false);
  });
});

describe("isNetworkEligibleProduct", () => {
  const p = { status: "ACTIVE", quantity: 1, fairHoldId: null, blurred: false, ageRestricted: false, restrictedSymbols: false };
  it("accepts an available, non-sensitive item", () => expect(isNetworkEligibleProduct(p)).toBe(true));
  it.each([
    ["reserved", { status: "RESERVED" }],
    ["sold", { status: "SOLD", quantity: 0 }],
    ["draft", { status: "DRAFT" }],
    ["out of stock", { quantity: 0 }],
    ["on a fair", { fairHoldId: "fair1" }],
    ["blurred", { blurred: true }],
    ["age restricted", { ageRestricted: true }],
    ["restricted symbols", { restrictedSymbols: true }],
  ])("rejects %s items", (_, patch) => expect(isNetworkEligibleProduct({ ...p, ...patch })).toBe(false));
});

const rule = (o: Partial<CompiledRule>): CompiledRule => ({ id: "r", name: "r", match: "CATEGORY", action: "HIDE_PRODUCT", note: null, countries: ["DE"], categoryIds: [], ...o });

describe("networkExclusionFor", () => {
  it("is null without a country or without rules for it", () => {
    expect(networkExclusionFor([rule({ categoryIds: ["c1"] })], null)).toBeNull();
    expect(networkExclusionFor([rule({ categoryIds: ["c1"] })], "NL")).toBeNull();
  });
  it("counts every action (hide, blur, no shipping) and merges categories", () => {
    const rules = [
      rule({ categoryIds: ["c2", "c1"] }),
      rule({ action: "BLUR_IMAGES", categoryIds: ["c1", "c3"] }),
      rule({ match: "DEACTIVATED_WEAPON", action: "NO_SHIPPING" }),
      rule({ match: "RESTRICTED_SYMBOLS", action: "BLUR_IMAGES", countries: ["FR"] }),
    ];
    expect(networkExclusionFor(rules, "de")).toEqual({ categoryIds: ["c1", "c2", "c3"], restrictedSymbols: false, ageRestricted: false, deactivatedWeapons: true });
  });
});

describe("shipsToCountry", () => {
  const nl = { countries: ["BE", "NL"], isActive: true, isPickup: false };
  it("matches listed countries and rest-of-world", () => {
    expect(shipsToCountry([nl], "NL")).toBe(true);
    expect(shipsToCountry([nl], "DE")).toBe(false);
    expect(shipsToCountry([nl, { countries: ["*"], isActive: true, isPickup: false }], "US")).toBe(true);
  });
  it("ignores inactive and pickup zones and unknown countries", () => {
    expect(shipsToCountry([{ ...nl, isActive: false }], "NL")).toBe(false);
    expect(shipsToCountry([{ countries: ["*"], isActive: true, isPickup: true }], "NL")).toBe(false);
    expect(shipsToCountry([nl], null)).toBe(false);
  });
});

describe("period / country across dealers", () => {
  const values: FacetValueFacts[] = [
    { id: "a1", tenantId: "A", parentId: null, name: "WW2", kind: "PERIOD" },
    { id: "a2", tenantId: "A", parentId: null, name: "Germany", kind: "COUNTRY" },
    { id: "a3", tenantId: "A", parentId: "a2", name: "Heer", kind: "COUNTRY" },
    { id: "b1", tenantId: "B", parentId: null, name: "ww2", kind: "PERIOD" },
    { id: "b2", tenantId: "B", parentId: null, name: "WW1", kind: "PERIOD" },
    { id: "b3", tenantId: "B", parentId: null, name: "Germany ", kind: "COUNTRY" },
  ];
  it("offers top-level names by number of dealers", () => {
    expect(networkFacetOptions(values, "PERIOD")).toEqual([
      { key: "ww2", label: "WW2", dealers: 2 },
      { key: "ww1", label: "WW1", dealers: 1 },
    ]);
  });
  it("maps a name to the value and its descendants in every shop", () => {
    expect(facetValueIdsFor(values, "COUNTRY", ["germany"])).toEqual(["a2", "a3", "b3"]);
    expect(facetValueIdsFor(values, "PERIOD", [])).toBeNull();
    expect(facetValueIdsFor(values, "PERIOD", ["korea"])).toEqual([]);
  });
});

describe("networkProductWhere", () => {
  it("is FALSE without dealers", () => expect(networkProductWhere({ tenantIds: [] }).sql).toBe("FALSE"));
  it("restricts to the dealers and excludes sensitive, held and unavailable items", () => {
    const w = networkProductWhere({ tenantIds: ["A", "B"] });
    expect(w.sql).toContain(`p."tenantId" = ANY(`);
    expect(w.sql).toContain(`p.status = 'ACTIVE' AND p.quantity > 0`);
    expect(w.sql).toContain(`p."fairHoldId" IS NULL`);
    expect(w.sql).toContain(`NOT p.blurred AND NOT p."ageRestricted" AND NOT p."restrictedSymbols"`);
    expect(w.values).toEqual([["A", "B"]]);
  });
  it("applies each dealer's country exclusion to that dealer only, and facet sets", () => {
    const w = networkProductWhere({
      tenantIds: ["A", "B"],
      exclusions: { A: { categoryIds: ["c1"], restrictedSymbols: false, ageRestricted: false, deactivatedWeapons: true }, B: null },
      facetValueIds: [["v1"], null, []],
    });
    expect(w.sql).toContain(`NOT (p."tenantId" = `);
    expect(w.sql).toContain(`p."requiresDeactivationCert"`);
    expect(w.sql).toContain("product_facet_values");
    expect(w.sql.endsWith("FALSE")).toBe(true); // an empty (but requested) facet set matches nothing
    expect(w.values).toEqual([["A", "B"], "A", ["c1"], ["v1"]]);
  });
});

describe("network URL params", () => {
  it("parses and normalises", () => {
    const p = parseNetworkParams({ q: "  stahlhelm   m40 ", dealer: ["concept", "Bad Slug!", "concept"], ships: "1", period: ["WW2"], page: "3" });
    expect(p).toEqual({ q: "stahlhelm m40", dealers: ["concept"], ships: true, period: ["ww2"], country: [], sort: "relevance", page: 3 });
    expect(parseNetworkParams({ sort: "relevance" }).sort).toBe("newest");
    expect(parseNetworkParams({ page: "9999" }).page).toBe(1);
  });
  it("round-trips through the query string", () => {
    const p = parseNetworkParams({ q: "helm", dealer: ["a", "b"], country: "germany", sort: "newest", page: "2" });
    expect(networkQueryString(p)).toBe("?q=helm&dealer=a&dealer=b&country=germany&sort=newest&page=2");
    expect(parseNetworkParams(Object.fromEntries([...new URLSearchParams(networkQueryString(p)).keys()].map((k) => [k, new URLSearchParams(networkQueryString(p)).getAll(k)])))).toEqual(p);
    expect(networkQueryString({})).toBe("");
  });
});
