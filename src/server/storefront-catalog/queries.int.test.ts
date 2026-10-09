import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { getCatalogFacets, getProductFacets, getPublicCategoryTree, getPublicProduct, getRelatedProducts, listCatalog, liveReservedIds, type ListScope } from "./queries";
import { parseCatalogParams } from "./params";

let code = 50000;
async function product(tenantId: string, data: Partial<{ title: string; status: "DRAFT" | "ACTIVE" | "RESERVED" | "SOLD" | "ARCHIVED" | "STOLEN"; price: number; quantity: number; categoryId: string | null; description: string; publishedAt: Date; tagIds: string[]; blurred: boolean }> = {}) {
  code += 1;
  const { tagIds, ...rest } = data;
  const p = await db.product.create({
    data: {
      tenantId,
      stockCode: code,
      slug: `item-${code}`,
      title: rest.title ?? `Item ${code}`,
      status: rest.status ?? "ACTIVE",
      price: rest.price ?? 10000,
      quantity: rest.quantity ?? 1,
      categoryId: rest.categoryId ?? null,
      description: rest.description ?? null,
      publishedAt: rest.publishedAt ?? new Date(Date.UTC(2026, 0, 1, 0, code % 60)),
      blurred: rest.blurred ?? false,
      purchasePrice: 1234,
      notes: "secret note",
      legacyData: { secret: true },
    },
  });
  for (const tagId of tagIds ?? []) await db.productTag.create({ data: { tenantId, productId: p.id, tagId } });
  return p;
}

const shop = (categoryIds: string[] | null = null): ListScope => ({ mode: "shop", categoryIds });

describe("storefront-catalog queries", () => {
  let tenantId: string;
  let otherTenant: string;
  beforeEach(async () => {
    await resetDb();
    tenantId = (await createTenantContext()).tenantId;
    otherTenant = (await createTenantContext()).tenantId;
  });

  it("lists only public statuses with stock, tenant-scoped, newest first", async () => {
    const a = await product(tenantId, { title: "Helmet A" });
    const b = await product(tenantId, { title: "Helmet B", status: "RESERVED", quantity: 0 });
    await product(tenantId, { status: "DRAFT" });
    await product(tenantId, { status: "ARCHIVED" });
    await product(tenantId, { status: "STOLEN" });
    await product(tenantId, { status: "SOLD", quantity: 0 });
    await product(tenantId, { status: "ACTIVE", quantity: 0 });
    await product(otherTenant, { title: "Other shop" });

    const page = await listCatalog(tenantId, shop(), parseCatalogParams({}));
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.id)).toEqual([b.id, a.id]);
    expect(page.items.map((i) => i.status)).toEqual(["reserved", "available"]);
    expect(JSON.stringify(page)).not.toMatch(/purchasePrice|secret|legacy/);

    const archive = await listCatalog(tenantId, { mode: "archive", categoryIds: null }, parseCatalogParams({}));
    expect(archive.total).toBe(1);
    expect(archive.items[0].status).toBe("sold");
  });

  it("sold archive: per-item hiding and sold price, most recently sold first, no price leaks", async () => {
    const sold = async (title: string, soldAt: Date, extra: { archiveHidden?: boolean; showSoldPrice?: boolean; price: number }) => {
      const p = await product(tenantId, { title, status: "SOLD", quantity: 0, price: extra.price });
      return db.product.update({ where: { id: p.id }, data: { soldAt, archiveHidden: extra.archiveHidden ?? false, showSoldPrice: extra.showSoldPrice ?? false } });
    };
    const older = await sold("M40 older", new Date(Date.UTC(2026, 6, 1)), { price: 50000, showSoldPrice: true });
    const newer = await sold("M40 newer", new Date(Date.UTC(2026, 9, 1)), { price: 90000 });
    const hidden = await sold("M40 hidden", new Date(Date.UTC(2026, 8, 1)), { price: 70000, archiveHidden: true, showSoldPrice: true });
    const archive: ListScope = { mode: "archive", categoryIds: null, priceUnit: 100 };
    const ids = async (raw: Record<string, string> = {}) => (await listCatalog(tenantId, archive, parseCatalogParams(raw))).items.map((i) => i.id);

    // archiveHidden is left out; newest sale first.
    expect(await ids()).toEqual([newer.id, older.id]);
    const page = await listCatalog(tenantId, archive, parseCatalogParams({}));
    expect(page.items.map((i) => [i.showSoldPrice, i.price])).toEqual([
      [false, 0], // hidden sold price never leaves the server
      [true, 50000],
    ]);
    // Price filters and sorting only see shown prices.
    expect(await ids({ min: "800" })).toEqual([]);
    expect(await ids({ max: "600" })).toEqual([older.id]);
    expect(await ids({ sort: "price_desc" })).toEqual([older.id, newer.id]);
    const facets = await getCatalogFacets(tenantId, archive, parseCatalogParams({}));
    expect(facets.price).toEqual({ min: 50000, max: 50000 });

    // The hidden item's page stays reachable (order links), flagged for noindex by the page.
    const detail = await getPublicProduct(tenantId, hidden.stockCode);
    expect(detail).toMatchObject({ status: "sold", archiveHidden: true, showSoldPrice: true, price: 70000 });
    expect((await getPublicProduct(tenantId, newer.stockCode))?.price).toBe(0);
  });

  it("filters by search, tags (AND), price and category subtree; sorts by price", async () => {
    const root = await db.category.create({ data: { tenantId, title: "Helmets", slug: "helmets" } });
    const child = await db.category.create({ data: { tenantId, title: "Steel", slug: "steel", parentId: root.id } });
    const other = await db.category.create({ data: { tenantId, title: "Caps", slug: "caps" } });
    const ww2 = await db.tag.create({ data: { tenantId, name: "WW2", slug: "ww2" } });
    const de = await db.tag.create({ data: { tenantId, name: "Germany", slug: "germany" } });
    const m40 = await product(tenantId, { title: "Stahlhelm M40", price: 145000, categoryId: child.id, tagIds: [ww2.id, de.id] });
    const m35 = await product(tenantId, { title: "Stahlhelm M35", price: 99000, categoryId: root.id, tagIds: [ww2.id], description: "Rare decal" });
    const cap = await product(tenantId, { title: "Field cap", price: 20000, categoryId: other.id, tagIds: [de.id] });

    const q = (raw: Record<string, string | string[]>, scope = shop()) => listCatalog(tenantId, scope, parseCatalogParams(raw)).then((r) => r.items.map((i) => i.id));
    expect(await q({ q: "stahl" })).toHaveLength(2);
    expect(await q({ q: "decal" })).toEqual([m35.id]);
    expect(await q({ q: `#${cap.stockCode}` })).toEqual([cap.id]);
    expect(await q({ tag: ["ww2", "germany"] })).toEqual([m40.id]);
    expect(await q({ tag: ["ww2", "nope"] })).toEqual([]);
    expect(await q({ min: "500", max: "1000" })).toEqual([m35.id]);
    expect(await q({ sort: "price_asc" })).toEqual([cap.id, m35.id, m40.id]);
    expect(await q({}, shop([root.id, child.id]))).toHaveLength(2);

    const facets = await getCatalogFacets(tenantId, shop([root.id, child.id]), parseCatalogParams({ tag: ["ww2"] }));
    // Category counts ignore the category scope but keep the tag filter.
    expect(facets.categoryCounts).toEqual({ [root.id]: 1, [child.id]: 1 });
    expect(facets.tags.find((t) => t.slug === "ww2")?.count).toBe(2);
    expect(facets.tags.find((t) => t.slug === "germany")?.count).toBe(1);
    expect(facets.price).toEqual({ min: 99000, max: 145000 });

    const tree = await getPublicCategoryTree(tenantId);
    expect(tree.find((n) => n.id === root.id)).toMatchObject({ count: 1, total: 2 });
    await db.category.update({ where: { id: root.id }, data: { isActive: false } });
    expect((await getPublicCategoryTree(tenantId)).map((n) => n.id)).toEqual([other.id]);
  });

  it("returns public product details and related items, never internals", async () => {
    const cat = await db.category.create({ data: { tenantId, title: "Helmets", slug: "helmets" } });
    const p = await product(tenantId, { title: "Main", categoryId: cat.id });
    const manual = await product(tenantId, { title: "Manual" });
    const sibling = await product(tenantId, { title: "Sibling", categoryId: cat.id });
    await product(tenantId, { title: "Draft sibling", categoryId: cat.id, status: "DRAFT" });
    await db.productRelation.create({ data: { tenantId, productId: p.id, relatedProductId: manual.id } });
    await db.product.update({ where: { id: p.id }, data: { specifications: [{ label: "Size", value: "64" }, { bad: 1 }] } });

    const detail = await getPublicProduct(tenantId, p.stockCode);
    expect(detail).toMatchObject({ title: "Main", status: "available", categoryPath: [{ slug: "helmets" }], specifications: [{ label: "Size", value: "64" }] });
    expect(JSON.stringify(detail)).not.toMatch(/purchasePrice|secret|legacy/);
    expect(await getPublicProduct(otherTenant, p.stockCode)).toBeNull();

    const draft = await product(tenantId, { status: "DRAFT" });
    expect(await getPublicProduct(tenantId, draft.stockCode)).toBeNull();
    const sold = await product(tenantId, { status: "SOLD", quantity: 0 });
    expect((await getPublicProduct(tenantId, sold.stockCode))?.status).toBe("sold");

    const related = await getRelatedProducts(tenantId, { id: p.id, relatedIds: detail!.relatedIds, categoryId: cat.id, tagIds: [] });
    expect(related.map((r) => r.id)).toEqual([manual.id, sibling.id]);
  });

  it("reads live reservations per request", async () => {
    const p = await product(tenantId);
    const cart = await db.cart.create({ data: { tenantId, tokenHash: "t", expiresAt: new Date(Date.now() + 86400_000) } });
    expect((await liveReservedIds(tenantId, [p.id])).size).toBe(0);
    await db.reservation.create({ data: { tenantId, productId: p.id, cartId: cart.id, status: "ACTIVE", expiresAt: new Date(Date.now() + 60_000) } });
    expect((await liveReservedIds(tenantId, [p.id])).has(p.id)).toBe(true);
    expect((await liveReservedIds(otherTenant, [p.id])).size).toBe(0);
  });

  it("filters by facets (OR within, AND across, descendants) with GROUP BY counts", async () => {
    const period = await db.facet.create({ data: { tenantId, kind: "PERIOD", name: "Period", slug: "period", sortOrder: 0 } });
    const branch = await db.facet.create({ data: { tenantId, kind: "BRANCH", name: "Branch", slug: "branch", sortOrder: 1 } });
    const hidden = await db.facet.create({ data: { tenantId, kind: "MAKER", name: "Maker", slug: "maker", sortOrder: 2, isFilterable: false } });
    const v = async (facetId: string, slug: string, parentId: string | null = null) => db.facetValue.create({ data: { tenantId, facetId, slug, name: slug.toUpperCase(), parentId } });
    const ww1 = await v(period.id, "ww1");
    const ww2 = await v(period.id, "ww2");
    const army = await v(branch.id, "army");
    const heer = await v(branch.id, "heer", army.id);
    const navy = await v(branch.id, "navy");
    const maker = await v(hidden.id, "erel");
    const link = (productId: string, ...valueIds: string[]) => db.productFacetValue.createMany({ data: valueIds.map((facetValueId) => ({ tenantId, productId, facetValueId })) });
    const p1 = await product(tenantId, { title: "M40" });
    const p2 = await product(tenantId, { title: "M16" });
    const p3 = await product(tenantId, { title: "Navy cap" });
    const p4 = await product(tenantId, { title: "Untagged" });
    const sold = await product(tenantId, { status: "SOLD", quantity: 0 });
    await link(p1.id, ww2.id, heer.id, maker.id);
    await link(p2.id, ww1.id, army.id);
    await link(p3.id, ww2.id, navy.id);
    await link(sold.id, ww2.id, heer.id);
    // Other tenant: same slugs, must not leak.
    const oFacet = await db.facet.create({ data: { tenantId: otherTenant, kind: "PERIOD", name: "Period", slug: "period" } });
    const oVal = await db.facetValue.create({ data: { tenantId: otherTenant, facetId: oFacet.id, slug: "ww2", name: "WW2" } });
    const op = await product(otherTenant, { title: "Other" });
    await db.productFacetValue.create({ data: { tenantId: otherTenant, productId: op.id, facetValueId: oVal.id } });

    const ids = async (raw: Record<string, string | string[]>, scope = shop()) => (await listCatalog(tenantId, scope, parseCatalogParams(raw))).items.map((i) => i.id).sort();
    expect(await ids({ f: "period.ww2" })).toEqual([p1.id, p3.id].sort());
    expect(await ids({ f: ["period.ww2", "period.ww1"] })).toEqual([p1.id, p2.id, p3.id].sort()); // OR within
    expect(await ids({ f: ["period.ww2", "branch.army"] })).toEqual([p1.id]); // AND across + Army ⊃ Heer
    expect(await ids({ f: "branch.heer" })).toEqual([p1.id]);
    expect(await ids({ f: "period.nope" })).toHaveLength(4); // unknown tokens are ignored
    expect(await ids({}, { ...shop(), lockedFacets: ["branch.navy"] })).toEqual([p3.id]);

    const facets = await getCatalogFacets(tenantId, shop(), parseCatalogParams({ f: ["period.ww2", "branch.army"] }));
    expect(facets.facets.map((f) => f.slug)).toEqual(["period", "branch"]); // not-filterable facet omitted
    const periodGroup = facets.facets[0];
    // Period counts ignore the period selection but keep branch=army (p1 ww2, p2 ww1).
    expect(periodGroup.values.map((x) => [x.slug, x.count, x.selected])).toEqual([
      ["ww1", 1, false],
      ["ww2", 1, true],
    ]);
    const branchGroup = facets.facets[1];
    // Branch counts keep period=ww2: army (incl. heer) = p1, navy = p3.
    expect(branchGroup.values.map((x) => [x.slug, x.count])).toEqual([
      ["army", 1],
      ["navy", 1],
    ]);
    expect(branchGroup.values[0].children[0]).toMatchObject({ slug: "heer", count: 1, token: "branch.heer" });

    // Unmapped tags only: a tag whose legacyId maps to a facet value is not offered as a tag filter.
    const mapped = await db.tag.create({ data: { tenantId, name: "WW2", slug: "ww2-tag", legacyId: 5 } });
    const free = await db.tag.create({ data: { tenantId, name: "Field gear", slug: "field-gear" } });
    await db.facetValue.update({ where: { id: ww2.id }, data: { legacyTagId: 5 } });
    await db.productTag.createMany({ data: [{ tenantId, productId: p4.id, tagId: mapped.id }, { tenantId, productId: p4.id, tagId: free.id }] });
    expect((await getCatalogFacets(tenantId, shop(), parseCatalogParams({}))).tags.map((t) => t.slug)).toEqual(["field-gear"]);

    const pf = await getProductFacets(tenantId, p1.id);
    expect(pf.map((g) => [g.facet.slug, g.values.map((x) => x.path.join(" › "))])).toEqual([
      ["period", ["WW2"]],
      ["branch", ["ARMY › HEER"]],
      ["maker", ["EREL"]],
    ]);
  });

  it("excludes products hidden by country compliance", async () => {
    const cat = await db.category.create({ data: { tenantId, title: "Reich", slug: "reich" } });
    const a = await product(tenantId, { title: "In category", categoryId: cat.id });
    const b = await product(tenantId, { title: "Symbols" });
    await db.product.update({ where: { id: b.id }, data: { restrictedSymbols: true } });
    const c = await product(tenantId, { title: "Plain" });
    const hide = { categoryIds: [cat.id], restrictedSymbols: true, ageRestricted: false, deactivatedWeapons: false };
    const page = await listCatalog(tenantId, { ...shop(), hide }, parseCatalogParams({}));
    expect(page.items.map((i) => i.id)).toEqual([c.id]);
    expect(page.total).toBe(1);
    const facets = await getCatalogFacets(tenantId, { ...shop(), hide }, parseCatalogParams({}));
    expect(facets.categoryCounts).toEqual({ "": 1 });
    expect((await listCatalog(tenantId, shop(), parseCatalogParams({}))).total).toBe(3);
    void a;
  });
});
