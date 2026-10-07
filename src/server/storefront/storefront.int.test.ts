import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { createProduct } from "@/server/catalog/products";
import { createCategory } from "@/server/catalog/categories";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { listProductsForSitemap, queryCategoryTiles, queryNewItems, queryProductsByIds, toProductCardData } from "./products";

const opts = { currency: "EUR", viewerSignedIn: false, blurSensitiveForGuests: true, showPriceWhenSold: false };

describe("storefront product reads", () => {
  let a: ServiceContext;
  let b: ServiceContext;
  beforeEach(async () => {
    await resetDb();
    a = await createTenantContext({ slug: "a" });
    b = await createTenantContext({ slug: "b" });
  });

  it("new items: only ACTIVE products of the tenant, newest first", async () => {
    const draft = await createProduct(a, { title: "Draft", price: 1000 });
    const p1 = await createProduct(a, { title: "First", price: 1000, status: "ACTIVE" });
    const p2 = await createProduct(a, { title: "Second", price: 2000, status: "ACTIVE" });
    await db.product.update({ where: { id: p1.id }, data: { publishedAt: new Date(Date.now() - 60_000) } });
    await createProduct(b, { title: "Other shop", price: 1000, status: "ACTIVE" });
    const rows = await queryNewItems(a.tenantId, 10);
    expect(rows.map((r) => r.title)).toEqual(["Second", "First"]);
    expect(rows.some((r) => r.id === draft.id)).toBe(false);
    expect(Object.keys(rows[0])).not.toContain("purchasePrice");
    expect(typeof rows[0].publishedAt === "string" || rows[0].publishedAt === null).toBe(true);
    expect(rows[0].id).toBe(p2.id);
  });

  it("products by id keep order and drop non-public / foreign ids", async () => {
    const x = await createProduct(a, { title: "X", price: 1000, status: "ACTIVE" });
    const y = await createProduct(a, { title: "Y", price: 1000, status: "ACTIVE" });
    const d = await createProduct(a, { title: "Draft", price: 1000 });
    const f = await createProduct(b, { title: "Foreign", price: 1000, status: "ACTIVE" });
    const rows = await queryProductsByIds(a.tenantId, [y.id, d.id, f.id, x.id]);
    expect(rows.map((r) => r.title)).toEqual(["Y", "X"]);
  });

  it("card data: sold hides price, sensitive items are locked for guests without real image url", async () => {
    const p = await createProduct(a, { title: "Sensitive", price: 5000, status: "ACTIVE", blurred: true });
    const [row] = await queryProductsByIds(a.tenantId, [p.id]);
    const withImage = { ...row, images: [{ storageKey: `${a.tenantId}/products/${p.id}/i1.jpg`, variants: { blur: { key: "k", dataUrl: "data:image/webp;base64,AAA" } }, alt: null, width: 10, height: 10 }] };
    const guest = toProductCardData(withImage, opts);
    expect(guest.locked).toBe(true);
    expect(guest.image?.src).toBe("");
    expect(guest.image?.blurDataUrl).toBe("data:image/webp;base64,AAA");
    const member = toProductCardData(withImage, { ...opts, viewerSignedIn: true });
    expect(member.locked).toBe(false);
    expect(member.image?.src).toContain("/uploads/");
    expect(toProductCardData({ ...row, status: "SOLD" }, opts)).toMatchObject({ availability: "sold", showPrice: false });
    expect(toProductCardData(row, { ...opts, reservedIds: new Set([p.id]) }).availability).toBe("reserved");
    expect(toProductCardData(row, opts).href).toBe(`/product/${p.stockCode}/${p.slug}`);
  });

  it("category tiles default to active top-level categories; sitemap skips sensitive and sold", async () => {
    const helmets = await createCategory(a, { title: "Helmets" });
    await createCategory(a, { title: "German", parentId: helmets.id });
    const hidden = await createCategory(a, { title: "Hidden" });
    await db.category.update({ where: { id: hidden.id }, data: { isActive: false } });
    const tiles = await queryCategoryTiles(a.tenantId, []);
    expect(tiles.map((t) => t.title)).toEqual(["Helmets"]);
    expect(tiles[0].href).toBe(`/shop/category/${helmets.slug}`);

    const ok = await createProduct(a, { title: "Ok", price: 100, status: "ACTIVE" });
    await createProduct(a, { title: "Blurred", price: 100, status: "ACTIVE", blurred: true });
    const sold = await createProduct(a, { title: "Sold", price: 100, status: "ACTIVE" });
    await db.product.update({ where: { id: sold.id }, data: { status: "SOLD" } });
    expect((await listProductsForSitemap(a.tenantId, false)).map((p) => p.stockCode)).toEqual([ok.stockCode]);
    expect((await listProductsForSitemap(a.tenantId, true)).length).toBe(2);
  });
});
