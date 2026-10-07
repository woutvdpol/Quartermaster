import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { createProduct } from "@/server/catalog/products";
import { createTag } from "@/server/catalog/tags";
import {
  assignFacetValues,
  convertTagsToFacet,
  createFacet,
  createFacetValue,
  deleteFacet,
  deleteFacetValue,
  getFacet,
  getProductFacetValueIds,
  getTaxonomy,
  listFacets,
  mergeFacetValues,
  moveFacet,
  moveFacetValue,
  reorderFacetValues,
  seedDefaultFacets,
  setProductFacetValues,
  unassignFacetValues,
  updateFacet,
  updateFacetValue,
} from "./service";

describe("facets", () => {
  let a: ServiceContext;
  let b: ServiceContext;
  beforeEach(async () => {
    await resetDb();
    a = await createTenantContext();
    b = await createTenantContext();
  });

  it("creates facets and value trees with unique slugs, ordering and cycle checks", async () => {
    const branch = await createFacet(a, { kind: "BRANCH", name: "Branch" });
    const dupe = await createFacet(a, { kind: "CUSTOM", name: "Branch" });
    expect([branch.slug, dupe.slug, dupe.sortOrder]).toEqual(["branch", "branch-2", 1]);
    await moveFacet(a, dupe.id, 0);
    expect((await listFacets(a)).map((f) => f.id)).toEqual([dupe.id, branch.id]);
    await updateFacet(a, dupe.id, { name: "Maker", kind: "MAKER", regenerateSlug: true, isFilterable: false });
    expect((await listFacets(a))[0]).toMatchObject({ slug: "maker", kind: "MAKER", isFilterable: false });

    const army = await createFacetValue(a, branch.id, { name: "Army" });
    const heer = await createFacetValue(a, branch.id, { name: "Heer", parentId: army.id });
    const inf = await createFacetValue(a, branch.id, { name: "Infantry", parentId: heer.id });
    const navy = await createFacetValue(a, branch.id, { name: "Navy" });
    const navy2 = await createFacetValue(a, branch.id, { name: "Navy" });
    expect(navy2.slug).toBe("navy-2");
    await expect(moveFacetValue(a, army.id, { parentId: inf.id })).rejects.toMatchObject({ code: "INVALID" });
    await expect(updateFacetValue(a, army.id, { parentId: army.id })).rejects.toMatchObject({ code: "INVALID" });
    const otherFacet = await createFacet(a, { kind: "PERIOD", name: "Period" });
    await expect(createFacetValue(a, otherFacet.id, { name: "X", parentId: army.id })).rejects.toMatchObject({ code: "INVALID" });

    await reorderFacetValues(a, branch.id, null, [navy2.id, navy.id, army.id]);
    const facet = await getFacet(a, branch.id);
    expect(facet.tree.map((n) => n.name)).toEqual(["Navy", "Navy", "Army"]);
    expect(facet.tree[2].children[0].children[0]).toMatchObject({ name: "Infantry", depth: 2 });
    expect((await getTaxonomy(a)).find((f) => f.id === branch.id)?.values.find((v) => v.id === inf.id)?.path).toBe("Army › Heer › Infantry");

    // Deleting a value moves its children up.
    await deleteFacetValue(a, heer.id);
    expect((await db.facetValue.findUniqueOrThrow({ where: { id: inf.id } })).parentId).toBe(army.id);
  });

  it("assigns, unassigns, replaces per facet and merges values", async () => {
    const period = await createFacet(a, { kind: "PERIOD", name: "Period" });
    const country = await createFacet(a, { kind: "COUNTRY", name: "Country" });
    const ww2 = await createFacetValue(a, period.id, { name: "WW2" });
    const wwii = await createFacetValue(a, period.id, { name: "WWII", legacyTagId: 77 });
    const sub = await createFacetValue(a, period.id, { name: "1944", parentId: wwii.id });
    const de = await createFacetValue(a, country.id, { name: "Germany" });
    const p1 = await createProduct(a, { title: "Helmet" });
    const p2 = await createProduct(a, { title: "Cap" });

    expect(await assignFacetValues(a, [p1.id, p2.id], [ww2.id, de.id])).toEqual({ linked: 4 });
    expect(await assignFacetValues(a, [p1.id], [ww2.id])).toEqual({ linked: 0 });
    await assignFacetValues(a, [p2.id], [wwii.id]);
    expect(await unassignFacetValues(a, [p1.id], [de.id])).toEqual({ unlinked: 1 });

    await setProductFacetValues(a, p1.id, [wwii.id], { facetId: period.id });
    await assignFacetValues(a, [p1.id], [de.id]);
    expect((await getProductFacetValueIds(a, p1.id)).sort()).toEqual([wwii.id, de.id].sort());
    await expect(setProductFacetValues(a, p1.id, [de.id], { facetId: period.id })).rejects.toMatchObject({ code: "INVALID" });

    const res = await mergeFacetValues(a, [wwii.id], ww2.id);
    expect(res).toEqual({ linked: 1, deleted: 1 }); // p2 already had ww2
    const merged = await db.facetValue.findUniqueOrThrow({ where: { id: ww2.id } });
    expect(merged.legacyTagId).toBe(77);
    expect((await db.facetValue.findUniqueOrThrow({ where: { id: sub.id } })).parentId).toBe(ww2.id);
    await expect(mergeFacetValues(a, [de.id], ww2.id)).rejects.toMatchObject({ code: "INVALID" });
    expect((await getFacet(a, period.id)).values.find((v) => v.id === ww2.id)?.productCount).toBe(2);
    expect((await listFacets(a)).find((f) => f.id === period.id)?.productCount).toBe(2);

    await deleteFacet(a, period.id);
    expect(await db.productFacetValue.count({ where: { facetValueId: ww2.id } })).toBe(0);
  });

  it("converts tags to facet values (reuse by name, legacy id, product links, optional delete)", async () => {
    const country = await createFacet(a, { kind: "COUNTRY", name: "Country" });
    const existing = await createFacetValue(a, country.id, { name: "germany" });
    const de = await createTag(a, { name: "Germany" });
    const nl = await createTag(a, { name: "Netherlands" });
    await db.tag.update({ where: { id: nl.id }, data: { legacyId: 12 } });
    const p1 = await createProduct(a, { title: "One", tagIds: [de.id, nl.id] });
    const p2 = await createProduct(a, { title: "Two", tagIds: [nl.id] });

    const res = await convertTagsToFacet(a, [de.id, nl.id], country.id, { deleteTags: true });
    expect(res).toMatchObject({ created: 1, reused: 1, linked: 3, deletedTags: 2 });
    expect(res.mapping[de.id]).toBe(existing.id);
    const nlValue = await db.facetValue.findUniqueOrThrow({ where: { id: res.mapping[nl.id] } });
    expect(nlValue).toMatchObject({ name: "Netherlands", slug: "netherlands", legacyTagId: 12 });
    expect((await getProductFacetValueIds(a, p2.id))).toEqual([nlValue.id]);
    expect((await getProductFacetValueIds(a, p1.id)).length).toBe(2);
    expect(await db.tag.count({ where: { tenantId: a.tenantId } })).toBe(0);

    // Keeping the tags, under a parent.
    const parent = await createFacetValue(a, country.id, { name: "Europe" });
    const be = await createTag(a, { name: "Belgium" });
    const r2 = await convertTagsToFacet(a, [be.id], country.id, { parentId: parent.id });
    expect(r2).toMatchObject({ created: 1, deletedTags: 0, linked: 0 });
    expect((await db.facetValue.findUniqueOrThrow({ where: { id: r2.mapping[be.id] } })).parentId).toBe(parent.id);
  });

  it("seeds the standard facets idempotently", async () => {
    const first = await seedDefaultFacets(a.tenantId);
    expect(first.facetsCreated).toBe(6);
    expect(first.valuesCreated).toBeGreaterThan(20);
    const again = await seedDefaultFacets(a.tenantId);
    expect(again).toEqual({ facetsCreated: 0, valuesCreated: 0 });
    const tax = await getTaxonomy(a);
    expect(tax.map((f) => f.slug)).toEqual(["period", "country", "branch", "unit", "type", "maker"]);
    expect(tax.find((f) => f.slug === "branch")?.values.find((v) => v.name === "Heer")?.path).toBe("Army › Heer");
    expect(await db.facet.count({ where: { tenantId: b.tenantId } })).toBe(0);
  });

  it("isolates tenants", async () => {
    const facet = await createFacet(a, { kind: "PERIOD", name: "Period" });
    const value = await createFacetValue(a, facet.id, { name: "WW2" });
    const pb = await createProduct(b, { title: "B item" });
    const pa = await createProduct(a, { title: "A item" });
    await expect(getFacet(b, facet.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateFacet(b, facet.id, { name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteFacet(b, facet.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createFacetValue(b, facet.id, { name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateFacetValue(b, value.id, { name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assignFacetValues(b, [pb.id], [value.id])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assignFacetValues(a, [pb.id], [value.id])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getProductFacetValueIds(b, pa.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const tagB = await createTag(b, { name: "WW2" });
    await expect(convertTagsToFacet(a, [tagB.id], facet.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listFacets(b)).toEqual([]);
  });
});
