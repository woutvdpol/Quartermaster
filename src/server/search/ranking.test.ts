import { describe, expect, it } from "vitest";
import { rrf } from "./rrf";
import { keepImageText, keepSemantic, semanticText, zScores } from "./ranking";
import { buildTsQueries, trigramTerms } from "./retrieval-pure";
import { TtlLru } from "./lru";
import { buildPassage, contentHash, stripMarkdown } from "./passage";
import { fold, tokenize } from "./normalize";

describe("rrf", () => {
  it("sums weight / (k + rank) over lists", () => {
    const out = rrf(
      [
        { name: "a", ids: ["x", "y", "z"] },
        { name: "b", ids: ["y", "x"] },
      ],
      { k: 60 },
    );
    expect(out.map((h) => h.id)).toEqual(["x", "y", "z"].sort((p, q) => (p === "z" ? 1 : q === "z" ? -1 : p.localeCompare(q))));
    const x = out.find((h) => h.id === "x")!;
    expect(x.score).toBeCloseTo(1 / 61 + 1 / 62);
    expect(x.ranks).toEqual({ a: 1, b: 2 });
  });

  it("an item in two lists beats an item that tops one list", () => {
    const out = rrf([
      { name: "lexical", ids: ["only-lex", "both"] },
      { name: "semantic", ids: ["only-sem", "both"] },
    ]);
    expect(out[0].id).toBe("both");
  });

  it("respects weights and ignores duplicates within a list", () => {
    const out = rrf([
      { name: "strong", ids: ["a"], weight: 2 },
      { name: "weak", ids: ["b", "b", "b"], weight: 0.5 },
    ]);
    expect(out.map((h) => h.id)).toEqual(["a", "b"]);
    expect(out[1].ranks.weak).toBe(1);
  });

  it("pins exact matches first, even when no list has them", () => {
    const out = rrf([{ name: "a", ids: ["x", "y"] }], { pinned: ["y", "stock"], limit: 3 });
    expect(out.map((h) => h.id)).toEqual(["y", "stock", "x"]);
  });

  it("zero-weight lists are ignored", () => {
    expect(rrf([{ name: "off", ids: ["a"], weight: 0 }])).toEqual([]);
  });
});

describe("ranking rules", () => {
  const hits = (scores: Record<string, number>) => Object.entries(scores).map(([id, score]) => ({ id, score }));

  it("zScores", () => {
    const z = zScores(hits({ a: 3, b: 1, c: 2 }));
    expect(z.get("c")).toBeCloseTo(0);
    expect(z.get("a")!).toBeGreaterThan(1);
    expect(zScores(hits({ a: 1, b: 1 })).get("a")).toBe(0);
  });

  it("semantic without lexical hits: floor + margin to the best", () => {
    const kept = keepSemantic(hits({ a: 0.86, b: 0.845, c: 0.83, d: 0.79 }), new Set());
    expect(kept.map((h) => h.id)).toEqual(["a", "b"]);
    expect(keepSemantic(hits({ a: 0.805 }), new Set())).toEqual([]); // below the floor
  });

  it("semantic with lexical hits: only outliers enter on their own; lexical items stay", () => {
    const many = { out: 0.9, lex: 0.82, ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`n${i}`, 0.8 + (i % 3) * 0.002])) };
    const kept = keepSemantic(hits(many).sort((p, q) => q.score - p.score), new Set(["lex"]));
    expect(kept.map((h) => h.id).sort()).toEqual(["lex", "out"]);
  });

  it("photo-space hits boost text hits; strangers only enter when text found nothing", () => {
    const many = { star: 0.09, text: 0.07, ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`n${i}`, 0.06 + (i % 5) * 0.001])) };
    const list = hits(many).sort((p, q) => q.score - p.score);
    expect(keepImageText(list, new Set(["text"])).map((h) => h.id)).toEqual(["text"]);
    expect(keepImageText(list, new Set()).map((h) => h.id)).toEqual(["star"]);
  });

  it("semanticText appends a few synonyms", () => {
    expect(semanticText({ text: "veldfles", expansions: { veldfles: ["canteen", "feldflasche", "water bottle", "drinkfles"] } })).toBe("veldfles (canteen, feldflasche, water bottle)");
    expect(semanticText({ text: "helm", expansions: {} })).toBe("helm");
  });
});

describe("lexical query building", () => {
  it("prefix terms, synonyms only in titles (weight A), phrases with <->", () => {
    const ts = buildTsQueries({ terms: ["veldfles", "1914"], expansions: { veldfles: ["canteen", "water bottle"] } })!;
    expect(ts.any).toBe("(veldfles:* | canteen:*A | (water:*A <-> bottle:*A)) | 1914");
    expect(ts.all).toBe("(veldfles:* | canteen:*A | (water:*A <-> bottle:*A)) & 1914");
    expect(ts.typed).toBe("veldfles:* | 1914");
  });

  it("never lets tsquery syntax through", () => {
    const ts = buildTsQueries({ terms: ["a'b|c&!d:*", "x"], expansions: {} })!;
    expect(ts.any).not.toMatch(/['&!|]\w|\|\|/);
    expect(ts.any).toContain("x");
    expect(buildTsQueries({ terms: [], expansions: {} })).toBeNull();
  });

  it("trigram terms skip short words and numbers", () => {
    expect(trigramTerms({ terms: ["jas", "stahlhem", "1914", "helm"] })).toEqual(["stahlhem", "helm"]);
  });
});

describe("helpers", () => {
  it("fold/tokenize", () => {
    expect(fold("  Feldmütze  Straße ")).toBe("feldmutze strasse");
    expect(tokenize("onder €500,- (nr. #50212)!")).toEqual(["onder", "€500", "nr", "#50212"]);
  });

  it("TtlLru expires and evicts", () => {
    let now = 0;
    const lru = new TtlLru<number>(2, 100, () => now);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.get("a");
    lru.set("c", 3); // evicts b (least recently used)
    expect(lru.get("b")).toBeUndefined();
    expect(lru.get("a")).toBe(1);
    now = 200;
    expect(lru.get("a")).toBeUndefined();
  });

  it("passage + hash", () => {
    const passage = buildPassage({
      title: "Stahlhelm M40",
      sku: null,
      description: "**Original** helmet, see [photos](https://x).\n\n- size 64",
      categoryPath: ["Helmets", "Steel helmets"],
      facets: [
        { facet: "Country", value: "Germany" },
        { facet: "Period", value: "WW2" },
      ],
      tags: ["ww2"],
      specifications: [{ label: "Maker", value: "ET" }],
    });
    expect(passage).toBe("Stahlhelm M40. Category: Helmets › Steel helmets. Country: Germany. Period: WW2. Tags: ww2. Maker: ET. Original helmet, see photos. size 64");
    expect(contentHash("m", passage)).toBe(contentHash("m", passage));
    expect(contentHash("m2", passage)).not.toBe(contentHash("m", passage));
    expect(stripMarkdown("# Title\n> quote `code`")).toBe("Title quote code");
  });
});
