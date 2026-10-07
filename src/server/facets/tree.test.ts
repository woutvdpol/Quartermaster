import { describe, expect, it } from "vitest";
import { buildValueTree, descendantIds, flattenValueTree, isSelfOrDescendant, valuePaths } from "./tree";

const v = (id: string, parentId: string | null, name = id, sortOrder = 0) => ({ id, parentId, name, sortOrder });

describe("facet value trees", () => {
  it("builds ordered trees, tolerating missing parents and cycles", () => {
    const values = [v("b", null, "B", 1), v("a", null, "A", 1), v("c", "a", "C"), v("x", "missing"), v("p", "q"), v("q", "p")];
    const tree = buildValueTree(values);
    expect(flattenValueTree(tree).map((n) => `${n.id}:${n.depth}`)).toContain("c:1");
    expect(tree.map((n) => n.id)).toEqual(["p", "q", "x", "a", "b"]);
    expect(flattenValueTree(tree)).toHaveLength(values.length);
  });

  it("finds descendants, ancestors and paths", () => {
    const values = [v("army", null, "Army"), v("heer", "army", "Heer"), v("inf", "heer", "Infantry"), v("navy", null, "Navy")];
    expect(descendantIds(values, "army")).toEqual(["army", "heer", "inf"]);
    expect(descendantIds(values, "navy")).toEqual(["navy"]);
    const parents = new Map(values.map((x) => [x.id, x.parentId]));
    expect(isSelfOrDescendant(parents, "army", "inf")).toBe(true);
    expect(isSelfOrDescendant(parents, "inf", "army")).toBe(false);
    expect(valuePaths(values).get("inf")).toEqual(["Army", "Heer", "Infantry"]);
  });
});
