import { describe, expect, it } from "vitest";
import type { PublicCategoryNode } from "@/server/storefront-catalog/types";
import { matchCategories, matchLevel, suggestWhy } from "./ui-labels";
import type { InterpretationChip } from "./parser";

const chip = (kind: InterpretationChip["kind"], label: string): InterpretationChip => ({ kind, label, matched: label, removeQuery: "" });

describe("suggestWhy", () => {
  const interp = { text: "helm", chips: [chip("facet", "Country: Germany"), chip("facet", "Period: WW2"), chip("price", "Max €500"), chip("sort", "Lowest price first")] };
  it("lists the matched words and understood filters", () => {
    expect(suggestWhy("lexical", interp)).toBe("Matches: helm · Germany · WW2 · Max €500");
    expect(suggestWhy("filters", { text: "", chips: [chip("facet", "Country: Germany")] })).toBe("Matches: Germany");
  });
  it("explains exact, typo and meaning matches", () => {
    expect(suggestWhy("exact", interp)).toBe("Exact item number");
    expect(suggestWhy("typo", { text: "stahlhem", chips: [] })).toBe("Close spelling: stahlhem");
    expect(suggestWhy("typo", { text: "helm", chips: [] }, "Stahlhelm M40 Heer")).toBe("Matches: helm");
    expect(suggestWhy("semantic", { text: "tunic with collar tabs", chips: [] })).toBe("Similar in meaning: tunic with collar tabs");
    expect(suggestWhy("lexical", { text: "", chips: [] })).toBe("Matches your search");
  });
});

describe("matchLevel", () => {
  it("maps photo similarity to labels", () => {
    expect(matchLevel(0.97)).toBe("very_close");
    expect(matchLevel(0.9)).toBe("close");
    expect(matchLevel(0.8)).toBe("similar");
    expect(matchLevel(undefined)).toBeNull();
  });
});

describe("matchCategories", () => {
  const node = (id: string, title: string, total: number, children: PublicCategoryNode[] = []): PublicCategoryNode => ({ id, parentId: null, title, slug: id, count: total, total, children });
  const tree = [node("helmets", "Steel helmets", 8, [node("german", "German helmets", 6), node("empty", "Helmet covers", 0)]), node("uniforms", "Uniforms", 7, [node("tunics", "Tunics & jackets", 4)])];
  it("matches word prefixes with the category path", () => {
    expect(matchCategories(tree, "helm", (s) => `/c/${s}`)).toEqual([
      { id: "helmets", label: "Steel helmets", href: "/c/helmets", count: 8 },
      { id: "german", label: "Steel helmets › German helmets", href: "/c/german", count: 6 },
    ]);
    expect(matchCategories(tree, "duitse helm germ", (s) => s)[0].id).toBe("german");
    expect(matchCategories(tree, "tu", (s) => s)).toEqual([]);
  });
});
