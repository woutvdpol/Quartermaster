import { describe, expect, it } from "vitest";
import { shopTagsForAction } from "./cache";

describe("shopTagsForAction", () => {
  it("maps catalog-affecting actions to the catalog tag", () => {
    for (const a of ["product.status", "category.move", "tag.merge", "stock.adjust", "product.images.added", "order.mark_paid"]) {
      expect(shopTagsForAction("t1", a)).toEqual(["tenant:t1:catalog"]);
    }
  });
  it("maps content and settings changes", () => {
    expect(shopTagsForAction("t1", "content.menu.update")).toEqual(["tenant:t1:content"]);
    expect(shopTagsForAction("t1", "settings.update")).toEqual(["tenant:t1"]);
  });
  it("maps redirect changes to the redirects tag", () => {
    for (const a of ["redirect.create", "redirect.update", "redirect.delete", "redirect.import"]) {
      expect(shopTagsForAction("t1", a)).toEqual(["tenant:t1:redirects"]);
    }
  });
  it("ignores actions that don't change the shop", () => {
    expect(shopTagsForAction("t1", "order.note")).toEqual([]);
    expect(shopTagsForAction("t1", "auth.login")).toEqual([]);
  });
});
