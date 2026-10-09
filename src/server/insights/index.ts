import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { ServiceError, type ServiceContext } from "@/server/context";
import { parseInput } from "@/server/catalog/errors";
import { updateProduct } from "@/server/catalog/products";
import { shopTag, tenantTag } from "@/server/storefront/cache";
import { requireTenantDisplay } from "@/server/tenant-display";
import { DEFAULT_STALE_DAYS, INSIGHT_PERIODS, STALE_DAY_OPTIONS, localDay, periodBounds, type InsightPeriod } from "./pure";
import { loadBuyMore, loadOverview, loadStale, type BuyMore, type InsightsOverview, type StaleList } from "./queries";

/*
 * Stock insights (docs/insights.md) — admin "Insights" page.
 *
 *   getInsightsOverview(ctx, q)  KPIs + by category
 *   getBuyMore(ctx, q)           fast sellers with little stock + top zero-result searches
 *   getStaleItems(ctx, q)        "sitting too long" with reason and suggestion
 *   repriceStaleItem(ctx, input) the one-click (+ confirm) reprice — through updateProduct, so audit,
 *                                shop cache invalidation and wishlist PRICE_DROP alerts run as usual
 *
 * Reads are data-cached per tenant for INSIGHTS_CACHE_SECONDS (tagged with the tenant's catalog tag,
 * so any product / order change that refreshes the shop also refreshes these figures). Pass
 * `{ cached: false }` outside a Next request (tests, scripts).
 */

export * from "./pure";
export type { BuyMore, BuyMoreGroup, CategoryInsight, InsightsOverview, StaleItem, StaleList, ZeroResultSearch } from "./queries";
export { recordShopSearch, recordShopSearchLater, type ShopSearchEvent } from "./search-stats";

export const INSIGHTS_CACHE_SECONDS = 120;

const querySchema = z.object({
  period: z.enum(INSIGHT_PERIODS).default("12m"),
  staleDays: z.coerce
    .number()
    .int()
    .refine((v) => (STALE_DAY_OPTIONS as readonly number[]).includes(v), "Unsupported threshold")
    .default(DEFAULT_STALE_DAYS),
});
export type InsightsQuery = z.input<typeof querySchema>;
type Opts = { cached?: boolean; now?: Date };

function cachedRead<R>(name: string, tenantId: string, key: unknown[], fn: () => Promise<R>, cached: boolean): Promise<R> {
  if (!cached) return fn();
  return unstable_cache(fn, ["insights", name, tenantId, JSON.stringify(key)], {
    revalidate: INSIGHTS_CACHE_SECONDS,
    tags: [tenantTag(tenantId), shopTag(tenantId, "catalog"), `tenant:${tenantId}:insights`],
  })();
}

async function setup(ctx: ServiceContext, input: InsightsQuery, opts: Opts) {
  const q = parseInput(querySchema, input);
  const { timeZone } = await requireTenantDisplay(ctx.tenantId);
  const now = opts.now ?? new Date();
  return { q, timeZone, now, bounds: periodBounds(q.period as InsightPeriod, now, timeZone), cached: opts.cached ?? true };
}

/** Per request: the KPI, category, "buy more" and "stale" sections all need the overview — compute it once. */
const overviewOnce = cache(
  (tenantId: string, period: InsightPeriod, staleDays: number, timeZone: string, cached: boolean, nowMs: number | null): Promise<InsightsOverview> => {
    const bounds = periodBounds(period, nowMs == null ? new Date() : new Date(nowMs), timeZone);
    return cachedRead("overview", tenantId, [period, staleDays], () => loadOverview(tenantId, period, bounds, staleDays), cached);
  },
);

export async function getInsightsOverview(ctx: ServiceContext, input: InsightsQuery = {}, opts: Opts = {}): Promise<InsightsOverview> {
  const { q, timeZone, cached } = await setup(ctx, input, opts);
  return overviewOnce(ctx.tenantId, q.period, q.staleDays, timeZone, cached, opts.now ? opts.now.getTime() : null);
}

export async function getBuyMore(ctx: ServiceContext, input: InsightsQuery = {}, opts: Opts = {}): Promise<BuyMore> {
  const { q, bounds, timeZone, cached } = await setup(ctx, input, opts);
  const overview = await getInsightsOverview(ctx, input, opts);
  return cachedRead("buy-more", ctx.tenantId, [q.period], () => loadBuyMore(ctx.tenantId, bounds, localDay(bounds.start, timeZone), overview), cached);
}

export async function getStaleItems(ctx: ServiceContext, input: InsightsQuery = {}, opts: Opts = {}): Promise<StaleList> {
  const { q, now, cached } = await setup(ctx, input, opts);
  const overview = await getInsightsOverview(ctx, input, opts);
  return cachedRead("stale", ctx.tenantId, [q.period, q.staleDays], () => loadStale(ctx.tenantId, q.staleDays, overview, now), cached);
}

const repriceSchema = z.object({
  productId: z.string().min(1).max(64),
  /** The price the dealer saw; the reprice is refused when it changed meanwhile. */
  expectedPrice: z.coerce.number().int().min(0),
  price: z.coerce.number().int().min(1),
});

/**
 * Lowers the price of an ACTIVE item to the suggested price (owner decision: one click + confirmation,
 * repricing only). Goes through updateProduct: audit "product.update", shop cache invalidation and
 * wishlist PRICE_DROP alerts behave exactly as for an edit in the product form.
 */
export async function repriceStaleItem(ctx: ServiceContext, input: z.input<typeof repriceSchema>) {
  const d = parseInput(repriceSchema, input);
  const current = await db.product.findFirst({ where: { id: d.productId, tenantId: ctx.tenantId }, select: { status: true, price: true } });
  if (!current) throw new ServiceError("NOT_FOUND", "Product not found");
  if (current.status !== "ACTIVE") throw new ServiceError("CONFLICT", "This item is no longer for sale");
  if (current.price !== d.expectedPrice) throw new ServiceError("CONFLICT", "The price was changed meanwhile; reload the page");
  if (d.price >= current.price) throw new ServiceError("INVALID", "A reprice must lower the price");
  const product = await updateProduct(ctx, d.productId, { price: d.price });
  return { id: product.id, stockCode: product.stockCode, price: product.price };
}
