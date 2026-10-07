import { describe, expect, it } from "vitest";
import { EMPTY_QUERY, isEmptyQuery, matchesQuery, normalizeQuery, queryKey, withAncestors, type MatchLookups, type ProductFacts } from "./match";

// Category tree: militaria › helmets › m35 ; militaria › medals
// Facets: country (germany › heer, france), period (ww2, ww1)
const lookups: MatchLookups = {
  categoryParent: new Map([
    ["militaria", null],
    ["helmets", "militaria"],
    ["m35", "helmets"],
    ["medals", "militaria"],
  ]),
  facetValues: new Map([
    ["germany", { facetId: "country", parentId: null }],
    ["heer", { facetId: "country", parentId: "germany" }],
    ["france", { facetId: "country", parentId: null }],
    ["ww2", { facetId: "period", parentId: null }],
    ["ww1", { facetId: "period", parentId: null }],
  ]),
};

const helmet: ProductFacts = {
  title: "German M35 Helmet, single decal",
  description: "Original Wehrmacht helmet",
  sku: "HLM-1",
  stockCode: 50231,
  price: 45000,
  categoryId: "m35",
  tagIds: ["tag-ww2", "tag-decal"],
  facetValueIds: ["heer", "ww2"],
};

const q = (patch: Record<string, unknown>) => normalizeQuery(patch);

describe("normalizeQuery", () => {
  it("drops junk, dedupes + sorts ids, swaps reversed price bounds", () => {
    expect(normalizeQuery({ q: "  m35   helmet ", tagIds: ["b", "a", "b", "bad id!"], priceMin: 500, priceMax: 100, x: 1 })).toEqual({
      q: "m35 helmet",
      categoryId: null,
      tagIds: ["a", "b"],
      facetValueIds: [],
      priceMin: 100,
      priceMax: 500,
    });
    expect(normalizeQuery(null)).toEqual(EMPTY_QUERY);
    expect(normalizeQuery({ priceMin: -5, priceMax: 1.5 })).toEqual(EMPTY_QUERY);
    expect(isEmptyQuery(normalizeQuery("nope"))).toBe(true);
  });

  it("queryKey is order-insensitive for ids and case-insensitive for text", () => {
    expect(queryKey(q({ q: "Helmet", tagIds: ["b", "a"] }))).toBe(queryKey(q({ q: "helmet", tagIds: ["a", "b"] })));
  });
});

describe("matchesQuery", () => {
  it("empty query matches every new arrival", () => {
    expect(matchesQuery(EMPTY_QUERY, helmet, lookups)).toBe(true);
  });

  it("category includes descendants", () => {
    expect(matchesQuery(q({ categoryId: "militaria" }), helmet, lookups)).toBe(true);
    expect(matchesQuery(q({ categoryId: "helmets" }), helmet, lookups)).toBe(true);
    expect(matchesQuery(q({ categoryId: "medals" }), helmet, lookups)).toBe(false);
    expect(matchesQuery(q({ categoryId: "helmets" }), { ...helmet, categoryId: null }, lookups)).toBe(false);
  });

  it("text: every word, case-insensitive, title/description/sku, stock code with #", () => {
    expect(matchesQuery(q({ q: "m35 WEHRMACHT" }), helmet, lookups)).toBe(true);
    expect(matchesQuery(q({ q: "hlm-1" }), helmet, lookups)).toBe(true);
    expect(matchesQuery(q({ q: "#50231" }), helmet, lookups)).toBe(true);
    expect(matchesQuery(q({ q: "m35 luftwaffe" }), helmet, lookups)).toBe(false);
  });

  it("tags: all required", () => {
    expect(matchesQuery(q({ tagIds: ["tag-ww2"] }), helmet, lookups)).toBe(true);
    expect(matchesQuery(q({ tagIds: ["tag-ww2", "tag-decal"] }), helmet, lookups)).toBe(true);
    expect(matchesQuery(q({ tagIds: ["tag-ww2", "tag-other"] }), helmet, lookups)).toBe(false);
  });

  it("facets: OR within a facet, AND across facets, ancestors match", () => {
    expect(matchesQuery(q({ facetValueIds: ["germany"] }), helmet, lookups)).toBe(true); // heer ⊂ germany
    expect(matchesQuery(q({ facetValueIds: ["heer"] }), { ...helmet, facetValueIds: ["germany"] }, lookups)).toBe(false); // not the other way
    expect(matchesQuery(q({ facetValueIds: ["france", "germany"] }), helmet, lookups)).toBe(true); // OR
    expect(matchesQuery(q({ facetValueIds: ["germany", "ww1"] }), helmet, lookups)).toBe(false); // AND across facets
    expect(matchesQuery(q({ facetValueIds: ["germany", "ww2"] }), helmet, lookups)).toBe(true);
    expect(matchesQuery(q({ facetValueIds: ["deleted-value"] }), helmet, lookups)).toBe(false);
  });

  it("price bounds are inclusive minor units", () => {
    expect(matchesQuery(q({ priceMin: 45000, priceMax: 45000 }), helmet, lookups)).toBe(true);
    expect(matchesQuery(q({ priceMax: 44999 }), helmet, lookups)).toBe(false);
    expect(matchesQuery(q({ priceMin: 45001 }), helmet, lookups)).toBe(false);
  });

  it("combines all criteria", () => {
    const query = q({ q: "helmet", categoryId: "helmets", tagIds: ["tag-ww2"], facetValueIds: ["germany"], priceMin: 10000, priceMax: 50000 });
    expect(matchesQuery(query, helmet, lookups)).toBe(true);
    expect(matchesQuery(query, { ...helmet, price: 60000 }, lookups)).toBe(false);
  });
});

describe("withAncestors", () => {
  it("walks up and survives cycles", () => {
    expect(withAncestors("m35", (id) => lookups.categoryParent.get(id))).toEqual(["m35", "helmets", "militaria"]);
    const cyclic = new Map([["a", "b"], ["b", "a"]]);
    expect(withAncestors("a", (id) => cyclic.get(id))).toEqual(["a", "b"]);
  });
});
