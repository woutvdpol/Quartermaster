import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { makeOrder, makeProduct } from "../orders/test-fixtures";
import { getBuyMore, getInsightsOverview, getStaleItems, recordShopSearch, repriceStaleItem } from "./index";

const DAY = 86_400_000;
const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const opts = { cached: false, now };
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

async function seed() {
  const ctx = await createTenantContext();
  const t = ctx.tenantId;
  const helmets = await db.category.create({ data: { tenantId: t, title: "Helmets", slug: "helmets" } });
  const german = await db.category.create({ data: { tenantId: t, title: "German helmets", slug: "german-helmets", parentId: helmets.id } });
  const docs = await db.category.create({ data: { tenantId: t, title: "Documents", slug: "documents" } });
  const country = await db.facet.create({ data: { tenantId: t, kind: "COUNTRY", name: "Country", slug: "country" } });
  const germany = await db.facetValue.create({ data: { tenantId: t, facetId: country.id, name: "Germany", slug: "germany" } });
  const tagGermany = (productId: string) => db.productFacetValue.create({ data: { tenantId: t, productId, facetValueId: germany.id } });

  /** A product listed `listedDaysAgo` and sold (paid order) `soldDaysAgo` days ago. */
  async function sold(categoryId: string, listedDaysAgo: number, soldDaysAgo: number, price: number, cost: number, facet = true) {
    const p = await makeProduct(t, { categoryId, price, purchasePrice: cost });
    if (facet) await tagGermany(p.id);
    await makeOrder(t, { lines: [{ product: p }], paymentStatus: "PAID", placedAt: ago(soldDaysAgo) });
    await db.product.update({ where: { id: p.id }, data: { status: "SOLD", quantity: 0, publishedAt: ago(listedDaysAgo), soldAt: ago(soldDaysAgo) } });
    return p;
  }
  async function active(categoryId: string, listedDaysAgo: number, price: number, cost: number, facet = true) {
    const p = await makeProduct(t, { categoryId, price, purchasePrice: cost });
    if (facet) await tagGermany(p.id);
    return db.product.update({ where: { id: p.id }, data: { publishedAt: ago(listedDaysAgo) } });
  }

  // Current 12 months: three German helmets (10, 20, 30 days to sell) and one slow document (150 days).
  await sold(german.id, 40, 30, 20_000, 10_000);
  await sold(german.id, 40, 20, 20_000, 10_000);
  await sold(german.id, 40, 10, 20_000, 10_000);
  await sold(docs.id, 200, 50, 5_000, 4_000, false);
  // The year before: one helmet in 20 days.
  await sold(german.id, 420, 400, 20_000, 10_000);
  // Stock: a fresh helmet, a helmet listed 300 days ago (comparables exist) and an old document.
  await active(german.id, 5, 20_000, 12_000);
  const staleHelmet = await active(german.id, 300, 34_500, 10_000);
  const staleDoc = await active(docs.id, 250, 9_900, 3_000, false);
  // Own analytics: three views of the stale helmet (one through a locale prefix), none of the document.
  await db.pageView.createMany({
    data: [
      { tenantId: t, path: `/product/${staleHelmet.stockCode}/${staleHelmet.slug}`, visitorHash: "a" },
      { tenantId: t, path: `/product/${staleHelmet.stockCode}/${staleHelmet.slug}`, visitorHash: "b" },
      { tenantId: t, path: `/nl/product/${staleHelmet.stockCode}/${staleHelmet.slug}`, visitorHash: "c" },
      { tenantId: t, path: "/shop", visitorHash: "d" },
    ],
  });
  return { ctx, helmets, docs, staleHelmet, staleDoc };
}

describe("stock insights", () => {
  beforeEach(resetDb);

  it("computes KPIs and the category table", async () => {
    const { ctx, helmets, docs } = await seed();
    const o = await getInsightsOverview(ctx, { period: "12m", staleDays: 180 }, opts);

    expect(o.kpis).toMatchObject({
      stockItems: 3,
      stockCost: 25_000,
      stockList: 64_400,
      stockMissingCost: 0,
      sold: 4,
      soldPrev: 1,
      medianDays: 25,
      medianDaysPrev: 20,
      marginPct: 47.7, // (65,000 − 34,000) / 65,000
      listed: 7,
      listedSold: 4,
      tiedItems: 2,
      tiedCost: 13_000,
    });
    expect(o.kpis.sellThrough).toBeCloseTo(4 / 7);
    expect(o.kpis.sellThroughPrev).toBe(1);

    expect(o.categories.map((c) => [c.id, c.title, c.inStock, c.sold, c.medianDays, c.marginPct])).toEqual([
      [helmets.id, "Helmets", 2, 3, 20, 50],
      [docs.id, "Documents", 1, 1, 150, 20],
    ]);
  });

  it("finds fast sellers with little stock and zero-result searches", async () => {
    const { ctx } = await seed();
    const t = ctx.tenantId;
    const search = (query: string, results: number, userAgent = BROWSER) => recordShopSearch({ tenantId: t, timeZone: "Europe/Amsterdam", query, results, userAgent });
    expect(await search("M35  Helmet", 0)).toBe(true);
    expect(await search("m35 helmet", 0)).toBe(true);
    expect(await search("helmet", 4)).toBe(true);
    expect(await search("50160", 0)).toBe(false); // stock number
    expect(await search("m35 helmet", 0, "Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(false);

    const rows = await db.searchQueryStat.findMany({ where: { tenantId: t }, orderBy: { query: "asc" } });
    expect(rows.map((r) => [r.query, r.searches, r.zeroResults])).toEqual([
      ["helmet", 1, 0],
      ["m35 helmet", 2, 2],
    ]);

    const b = await getBuyMore(ctx, { period: "12m" }, opts);
    expect(b.groups.map((g) => [g.label, g.sold, g.medianDays, g.marginPct, g.inStock])).toEqual([["Helmets · Germany", 3, 20, 50, 2]]);
    expect(b.zeroResults).toEqual([{ query: "m35 helmet", searches: 2, zeroResults: 2 }]);
  });

  it("lists items sitting too long with reason and a reprice that goes through the product service", async () => {
    const { ctx, staleHelmet, staleDoc } = await seed();
    const s = await getStaleItems(ctx, { period: "12m", staleDays: 180 }, opts);
    expect(s.total).toBe(2);
    expect(s.totalCost).toBe(13_000);
    const [helmet, doc] = s.items;
    expect(helmet).toMatchObject({ id: staleHelmet.id, views: 3, interest: 0, reason: "comparables", reprice: { price: 20_000, low: 20_000, high: 20_000, count: 4 } });
    expect(doc).toMatchObject({ id: staleDoc.id, views: 0, reason: "findability", reprice: null });

    await expect(repriceStaleItem(ctx, { productId: staleHelmet.id, expectedPrice: 30_000, price: 20_000 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repriceStaleItem(ctx, { productId: staleHelmet.id, expectedPrice: 34_500, price: 40_000 })).rejects.toBeInstanceOf(ServiceError);
    expect(await repriceStaleItem(ctx, { productId: staleHelmet.id, expectedPrice: 34_500, price: 20_000 })).toMatchObject({ price: 20_000 });
    expect((await db.product.findUniqueOrThrow({ where: { id: staleHelmet.id } })).price).toBe(20_000);
    expect(await db.auditLog.count({ where: { tenantId: ctx.tenantId, action: "product.update" } })).toBe(1);

    // Another shop's data never leaks in.
    const other = await createTenantContext();
    expect((await getStaleItems(other, {}, opts)).total).toBe(0);
  });
});
