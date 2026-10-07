import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { getCatalogFacets, getPublicCategoryTree, getPublicProduct, getRelatedProducts, listCatalog, liveReservedIds, type ListScope } from "./queries";
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
});
