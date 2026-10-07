import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { createCategory, deleteCategory, getCategory, listCategoryTree, moveCategory, reorderCategories, updateCategory } from "./categories";
import { createTag, deleteTag, listTags, mergeTags, updateTag } from "./tags";
import { createProduct, getProduct } from "./products";

describe("catalog/categories", () => {
  let a: ServiceContext;
  let b: ServiceContext;
  beforeEach(async () => {
    await resetDb();
    a = await createTenantContext();
    b = await createTenantContext();
  });

  it("builds a tree with ordering, unique slugs and product counts", async () => {
    const helmets = await createCategory(a, { title: "Helmets" });
    const ger = await createCategory(a, { title: "German", parentId: helmets.id });
    const us = await createCategory(a, { title: "US", parentId: helmets.id });
    const dupe = await createCategory(a, { title: "German" });
    expect([ger.sortOrder, us.sortOrder]).toEqual([0, 1]);
    expect(dupe.slug).toBe("german-2");
    await createProduct(a, { title: "M35", categoryId: ger.id });
    await createProduct(a, { title: "M42", categoryId: ger.id });
    await createProduct(a, { title: "Lid", categoryId: helmets.id });
    await createCategory(b, { title: "Other" });

    const tree = await listCategoryTree(a);
    expect(tree.map((n) => n.title)).toEqual(["Helmets", "German"]);
    expect(tree[0]).toMatchObject({ productCount: 1, totalProductCount: 3 });
    expect(tree[0].children.map((c) => [c.title, c.productCount])).toEqual([
      ["German", 2],
      ["US", 0],
    ]);

    await reorderCategories(a, helmets.id, [us.id, ger.id]);
    expect((await listCategoryTree(a))[0].children.map((c) => c.title)).toEqual(["US", "German"]);
    await expect(reorderCategories(a, helmets.id, [us.id])).rejects.toMatchObject({ code: "INVALID" });
  });

  it("prevents cycles on move and update", async () => {
    const root = await createCategory(a, { title: "Root" });
    const child = await createCategory(a, { title: "Child", parentId: root.id });
    const grandchild = await createCategory(a, { title: "Grandchild", parentId: child.id });
    await expect(moveCategory(a, root.id, { parentId: grandchild.id })).rejects.toMatchObject({ code: "INVALID" });
    await expect(moveCategory(a, root.id, { parentId: root.id })).rejects.toMatchObject({ code: "INVALID" });
    await expect(updateCategory(a, child.id, { parentId: grandchild.id })).rejects.toMatchObject({ code: "INVALID" });

    await moveCategory(a, grandchild.id, { parentId: null, index: 0 });
    const tree = await listCategoryTree(a);
    expect(tree.map((n) => n.title)).toEqual(["Grandchild", "Root"]);
    // concurrent opposite moves cannot both succeed into a cycle
    const x = await createCategory(a, { title: "X" });
    const y = await createCategory(a, { title: "Y" });
    await Promise.allSettled([moveCategory(a, x.id, { parentId: y.id }), moveCategory(a, y.id, { parentId: x.id })]);
    const [cx, cy] = await Promise.all([getCategory(a, x.id), getCategory(a, y.id)]);
    expect(cx.parentId === y.id && cy.parentId === x.id).toBe(false);
  });

  it("isolates tenants", async () => {
    const cat = await createCategory(a, { title: "Mine" });
    await expect(getCategory(b, cat.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateCategory(b, cat.id, { title: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createCategory(b, { title: "Sub", parentId: cat.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteCategory(b, cat.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deletes only when empty, or reassigns contents", async () => {
    const src = await createCategory(a, { title: "Src" });
    const sub = await createCategory(a, { title: "Sub", parentId: src.id });
    const target = await createCategory(a, { title: "Target" });
    const p = await createProduct(a, { title: "Thing", categoryId: src.id });
    await expect(deleteCategory(a, src.id)).rejects.toMatchObject({ code: "CONFLICT", details: { productCount: 1, childCount: 1 } });
    await expect(deleteCategory(a, src.id, { reassignTo: sub.id })).rejects.toMatchObject({ code: "INVALID" });
    expect(await deleteCategory(a, src.id, { reassignTo: target.id })).toEqual({ movedProducts: 1, movedChildren: 1 });
    expect((await getProduct(a, p.id)).categoryId).toBe(target.id);
    expect((await getCategory(a, sub.id)).parentId).toBe(target.id);
    const empty = await createCategory(a, { title: "Empty" });
    await deleteCategory(a, empty.id);
    await expect(getCategory(a, empty.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("slug changes only on request; explicit taken slug conflicts", async () => {
    const c = await createCategory(a, { title: "Medals" });
    await createCategory(a, { title: "Badges" });
    expect((await updateCategory(a, c.id, { title: "Awards" })).slug).toBe("medals");
    expect((await updateCategory(a, c.id, { regenerateSlug: true })).slug).toBe("awards");
    await expect(updateCategory(a, c.id, { slug: "badges" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("catalog/tags", () => {
  let a: ServiceContext;
  beforeEach(async () => {
    await resetDb();
    a = await createTenantContext();
  });

  it("CRUD with case-insensitive unique names", async () => {
    const t = await createTag(a, { name: "Kriegsmarine" });
    expect(t.slug).toBe("kriegsmarine");
    await expect(createTag(a, { name: "kriegsMARINE" })).rejects.toMatchObject({ code: "CONFLICT" });
    const other = await createTenantContext();
    await expect(createTag(other, { name: "Kriegsmarine" })).resolves.toBeTruthy();
    await expect(updateTag(other, t.id, { name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await updateTag(a, t.id, { name: "Navy", regenerateSlug: true })).slug).toBe("navy");
    expect((await listTags(a, { search: "av" })).map((x) => x.name)).toEqual(["Navy"]);
    await deleteTag(a, t.id);
    expect(await listTags(a)).toEqual([]);
  });

  it("merges tags without duplicate links", async () => {
    const [ww2, wwii, ww_2, keep] = await Promise.all(["WW2", "WWII", "WW 2", "Rare"].map((name) => createTag(a, { name })));
    const p1 = await createProduct(a, { title: "One", tagIds: [ww2.id, wwii.id] });
    const p2 = await createProduct(a, { title: "Two", tagIds: [ww_2.id, keep.id] });
    expect(await mergeTags(a, [wwii.id, ww_2.id], ww2.id)).toEqual({ linked: 1, deleted: 2 });
    expect((await getProduct(a, p1.id)).tags.map((t) => t.name)).toEqual(["WW2"]);
    expect((await getProduct(a, p2.id)).tags.map((t) => t.name).sort()).toEqual(["Rare", "WW2"]);
    const rows = await listTags(a);
    expect(rows.map((r) => [r.name, r.productCount])).toEqual([
      ["Rare", 1],
      ["WW2", 2],
    ]);
    expect(await db.tag.count({ where: { tenantId: a.tenantId } })).toBe(2);
    await expect(mergeTags(a, [ww2.id], ww2.id)).rejects.toMatchObject({ code: "INVALID" });
  });
});
