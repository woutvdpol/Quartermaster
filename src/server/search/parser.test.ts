import { describe, expect, it } from "vitest";
import type { PublicTaxonomy } from "@/server/storefront-catalog/types";
import { buildDictionary, buildExpansions, parseAmount, parseQuery, type ParserInput } from "./parser";
import { DEFAULT_SYNONYMS, parseSynonyms } from "./synonyms";

/** The standard facets (src/server/facets/defaults.ts) + a few type values, like the demo shop. */
function taxonomy(): PublicTaxonomy {
  const facets = [
    { id: "f-period", kind: "PERIOD", name: "Period", slug: "period" },
    { id: "f-country", kind: "COUNTRY", name: "Country", slug: "country" },
    { id: "f-branch", kind: "BRANCH", name: "Branch", slug: "branch" },
    { id: "f-unit", kind: "UNIT", name: "Unit", slug: "unit" },
    { id: "f-type", kind: "TYPE", name: "Type", slug: "type" },
  ].map((f, i) => ({ ...f, sortOrder: i, isFilterable: true }));
  const v = (facetId: string, name: string, slug: string, parentId: string | null = null) => ({ id: `v-${slug}`, facetId, parentId, name, slug, sortOrder: 0 });
  return {
    facets,
    values: [
      v("f-period", "WW1", "ww1"),
      v("f-period", "WW2", "ww2"),
      v("f-period", "Cold War", "cold-war"),
      v("f-period", "Pre-WW1", "pre-ww1"),
      v("f-country", "Germany", "germany"),
      v("f-country", "Netherlands", "netherlands"),
      v("f-country", "United Kingdom", "united-kingdom"),
      v("f-country", "USA", "usa"),
      v("f-country", "Soviet Union", "soviet-union"),
      v("f-branch", "Army", "army"),
      v("f-branch", "Heer", "heer", "v-army"),
      v("f-branch", "Air Force", "air-force"),
      v("f-branch", "Luftwaffe", "luftwaffe", "v-air-force"),
      v("f-unit", "Airborne", "airborne"),
      v("f-type", "Helmets", "helmets"),
      v("f-type", "Uniforms", "uniforms"),
    ],
  };
}

const input: ParserInput = { taxonomy: taxonomy(), synonyms: parseSynonyms(DEFAULT_SYNONYMS), currency: "EUR" };
const prepared = { dict: buildDictionary(input), expansions: buildExpansions(input) };
const parse = (q: string) => parseQuery(q, input, prepared);

describe("parseQuery — facets from words (NL/DE/EN)", () => {
  it("understands 'Duitse helm WW2 onder 500 euro'", () => {
    const p = parse("Duitse helm WW2 onder 500 euro");
    expect(p.facets).toEqual(["country.germany", "type.helmets", "period.ww2"]);
    expect(p.max).toBe(500);
    expect(p.min).toBeNull();
    // A type word stays searchable text; country/period/price words are consumed.
    expect(p.text).toBe("helm");
    expect(p.terms).toEqual(["helm"]);
    expect(p.chips.map((c) => c.label)).toEqual(["Max €500", "Country: Germany", "Type: Helmets", "Period: WW2"]);
  });

  it.each([
    ["deutscher Stahlhelm", "country.germany"],
    ["German helmet", "country.germany"],
    ["helm uit de tweede wereldoorlog", "period.ww2"],
    ["Helm 2. Weltkrieg", "period.ww2"],
    ["second world war helmet", "period.ww2"],
    ["WO II", "period.ww2"],
    ["jas uit de koude oorlog", "period.cold-war"],
    ["Kalter Krieg Uniform", "period.cold-war"],
    ["Britse baret", "country.united-kingdom"],
    ["amerikaanse para patch", "country.usa"],
    ["Russische medaille", "country.soviet-union"],
    ["fallschirmjäger", "unit.airborne"],
    ["luftwaffe bluse", "branch.luftwaffe"],
    ["pre-ww1 helmet", "period.pre-ww1"],
  ])("%s → %s", (q, token) => {
    expect(parse(q).facets).toContain(token);
  });

  it("prefers the longest phrase and ignores case/accents", () => {
    const p = parse("TWEEDE WERELDOORLOG helm");
    expect(p.facets).toEqual(["period.ww2", "type.helmets"]);
    expect(parse("Feldmütze Kalter Krieg").facets).toEqual(["period.cold-war"]);
  });

  it("matches facet value names and slugs of the shop directly", () => {
    expect(parse("heer").facets).toEqual(["branch.heer"]);
    expect(parse("cold-war").facets).toEqual(["period.cold-war"]);
  });

  it("each chip's removeQuery drops exactly its words", () => {
    const p = parse("Duitse helm WW2 onder 500 euro");
    const byLabel = Object.fromEntries(p.chips.map((c) => [c.label, c.removeQuery]));
    expect(byLabel["Country: Germany"]).toBe("helm WW2 onder 500 euro");
    expect(byLabel["Period: WW2"]).toBe("Duitse helm onder 500 euro");
    expect(byLabel["Max €500"]).toBe("Duitse helm WW2");
  });

  it("leaves unknown words as text and drops stopwords", () => {
    const p = parse("feldbluse met kraagspiegels");
    expect(p.facets).toEqual([]);
    expect(p.text).toBe("feldbluse kraagspiegels");
    expect(p.terms).toEqual(["feldbluse", "kraagspiegels"]);
  });
});

describe("parseQuery — prices", () => {
  it.each([
    ["helm onder 500", null, 500],
    ["helm onder €500", null, 500],
    ["helm onder € 500,-", null, 500],
    ["helmet under $250", null, 250],
    ["Helm unter 1.500 Euro", null, 1500],
    ["helm max 300 euro", null, 300],
    ["helm tot 300 euro", null, 300],
    ["helm bis 300€", null, 300],
    ["helm boven 1000", 1000, null],
    ["helm vanaf 200 euro", 200, null],
    ["helmet over 750", 750, null],
    ["helm tussen 100 en 500 euro", 100, 500],
    ["helm between 100 and 500", 100, 500],
    ["Helm zwischen 100 und 500 Euro", 100, 500],
    ["helm 100-500 euro", 100, 500],
    ["helm €100 - €500", 100, 500],
    ["helm van 100 tot 500", 100, 500],
  ])("%s → min %s max %s", (q, min, max) => {
    const p = parse(q);
    expect(p.min).toBe(min);
    expect(p.max).toBe(max);
    expect(p.text).toMatch(/^helm/i);
    expect(p.chips.some((c) => c.kind === "price")).toBe(true);
  });

  it("does not read years as prices", () => {
    expect(parse("iron cross 1914").max).toBeNull();
    expect(parse("helm tot 1945").max).toBeNull();
    expect(parse("medaille vanaf 1939").min).toBeNull();
    expect(parse("helm tussen 1939 en 1945").min).toBeNull();
    const ww2 = parse("1939-1945 helm");
    expect(ww2.min).toBeNull();
    expect(ww2.facets).toContain("period.ww2");
  });

  it("keeps years as search text", () => {
    expect(parse("iron cross 1914").terms).toEqual(["iron", "cross", "1914"]);
  });

  it("parseAmount handles separators and currency", () => {
    expect(parseAmount("€1.250")).toEqual({ value: 1250, currency: true });
    expect(parseAmount("1,250")).toEqual({ value: 1250, currency: false });
    expect(parseAmount("499,95")).toEqual({ value: 499, currency: false });
    expect(parseAmount("500eur")).toEqual({ value: 500, currency: true });
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("parseQuery — stock numbers, status, sort", () => {
  it.each(["#50212", "nr 50212", "no. 50212", "Nr. 50212", "item 50212"])("%s → stock code", (q) => {
    const p = parse(q);
    expect(p.stockCode).toBe(50212);
    expect(p.chips[0]).toMatchObject({ kind: "stock", label: "No. 50212" });
    expect(p.text).toBe("");
  });

  it("treats a bare 5+ digit number as a likely stock code but keeps it as text", () => {
    const p = parse("50212");
    expect(p.stockCode).toBe(50212);
    expect(p.text).toBe("50212");
    expect(parse("1914").stockCode).toBeNull();
  });

  it("understands sold / available words", () => {
    expect(parse("verkochte helmen").status).toBe("sold");
    expect(parse("sold helmets").status).toBe("sold");
    expect(parse("verkaufte Helme").status).toBe("sold");
    const avail = parse("beschikbare helm op voorraad");
    expect(avail.status).toBeNull();
    expect(avail.chips.some((c) => c.kind === "status")).toBe(false);
  });

  it("understands cheap / expensive as a sort", () => {
    expect(parse("goedkope helm").sort).toBe("price_asc");
    expect(parse("cheapest helmet").sort).toBe("price_asc");
    expect(parse("teure Helme").sort).toBe("price_desc");
  });
});

describe("parseQuery — synonym term groups", () => {
  it("expands words of a term group (lexical side)", () => {
    const p = parse("veldfles");
    expect(p.expansions.veldfles).toEqual(expect.arrayContaining(["canteen", "feldflasche", "water bottle"]));
  });

  it("expands multi-word phrases as a whole", () => {
    const p = parse("ijzeren kruis 1939");
    expect(p.expansions["ijzeren kruis"]).toEqual(expect.arrayContaining(["iron cross", "eisernes kreuz"]));
  });

  it("an owner line whose canonical is a facet value maps to that filter", () => {
    const own: ParserInput = { ...input, synonyms: parseSynonyms("Netherlands: knil, oranje\nGermany: duits") };
    const p = parseQuery("oranje helm", own);
    expect(p.facets).toEqual(["country.netherlands"]);
  });

  it("an owner line whose canonical is not a facet value is a term group, not a filter", () => {
    const own: ParserInput = { ...input, synonyms: parseSynonyms("pickelhaube: punthelm, spike helmet") };
    const p = parseQuery("punthelm", own);
    expect(p.facets).toEqual([]);
    expect(p.expansions.punthelm).toEqual(expect.arrayContaining(["pickelhaube", "spike helmet"]));
  });

  it("works for a shop without facets (facet lines become term groups)", () => {
    const bare: ParserInput = { taxonomy: { facets: [], values: [] }, synonyms: parseSynonyms(DEFAULT_SYNONYMS) };
    const p = parseQuery("duitse helm", bare);
    expect(p.facets).toEqual([]);
    expect(p.text).toBe("duitse helm");
    expect(p.expansions.helm).toEqual(expect.arrayContaining(["helmet", "stahlhelm"]));
  });
});
