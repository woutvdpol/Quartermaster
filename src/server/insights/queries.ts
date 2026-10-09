import "server-only";
import { db } from "@/server/db";
import { Prisma } from "@/generated/prisma/client";
import {
  daysBetween,
  marginPct,
  pickBuyMore,
  sellThrough,
  staleReason,
  suggestReprice,
  type InsightPeriod,
  type PeriodBounds,
  type RepriceSuggestion,
  type SalesGroup,
  type StaleReason,
} from "./pure";

/*
 * Stock insights queries (docs/insights.md). Every section is one or two aggregate SQL statements,
 * always filtered on tenantId. Definitions:
 *  - a "sale" is an order line of a PAID order; its moment is COALESCE(paidAt, placedAt) (as the
 *    dashboard and the margin report); revenue is net of the coupon discount, spread pro rata;
 *  - days to sell = sale moment − Product.publishedAt (lines without a listing date are left out);
 *  - stock = ACTIVE + RESERVED products × quantity; stock age = COALESCE(publishedAt, createdAt);
 *  - categories roll up to their top-level category (whole subtree).
 * Results are plain JSON (dates as ISO strings) so they can be data-cached.
 */

const ts = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** Category id → top-level category id, for the whole tree of the tenant. */
const treeCte = (tenantId: string) => Prisma.sql`
  tree AS (
    SELECT id, id AS root_id FROM categories WHERE "tenantId" = ${tenantId} AND "parentId" IS NULL
    UNION
    SELECT c.id, tree.root_id FROM categories c JOIN tree ON c."parentId" = tree.id WHERE c."tenantId" = ${tenantId}
  )`;

const SALE_AT = Prisma.sql`COALESCE(o."paidAt", o."placedAt")`;
/** Line revenue net of the order's coupon discount (as src/server/purchasing marginReport). */
const NET_LINE = Prisma.sql`(ol."lineTotal" - COALESCE(o."discountTotal"::numeric * ol."lineTotal" / NULLIF(o.subtotal, 0), 0))`;
const DAYS_TO_SELL = Prisma.sql`CASE WHEN p."publishedAt" IS NOT NULL AND p."publishedAt" <= ${SALE_AT}
  THEN EXTRACT(EPOCH FROM (${SALE_AT} - p."publishedAt")) / 86400.0 END`;

const n = (v: bigint | number | null | undefined) => (v == null ? 0 : Number(v));
const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));

// ─── Overview: KPIs + by category ───────────────────────────────────────────

export type CategoryInsight = {
  id: string | null;
  title: string;
  inStock: number;
  sold: number;
  medianDays: number | null;
  marginPct: number | null;
  listed: number;
  sellThrough: number | null;
};

export type InsightsOverview = {
  period: InsightPeriod;
  start: string;
  end: string;
  staleDays: number;
  kpis: {
    stockItems: number;
    stockCost: number;
    stockList: number;
    /** Items in stock without a purchase price (counted at 0 in stockCost). */
    stockMissingCost: number;
    medianDays: number | null;
    medianDaysPrev: number | null;
    sold: number;
    soldPrev: number;
    marginPct: number | null;
    marginPctPrev: number | null;
    listed: number;
    listedSold: number;
    sellThrough: number | null;
    sellThroughPrev: number | null;
    tiedItems: number;
    tiedCost: number;
  };
  categories: CategoryInsight[];
};

type SalesRow = { is_total: boolean; root: string | null; cur: boolean; sold: number; median_days: number | null; costed_revenue: bigint; cost: bigint };
type StockRow = {
  is_total: boolean;
  root: string | null;
  in_stock: number;
  stock_cost: bigint;
  stock_list: bigint;
  missing_cost: number;
  tied_items: number;
  tied_cost: bigint;
  listed: number;
  listed_sold: number;
  listed_prev: number;
  listed_sold_prev: number;
};

export async function loadOverview(tenantId: string, period: InsightPeriod, b: PeriodBounds, staleDays: number): Promise<InsightsOverview> {
  const staleBefore = new Date(b.end.getTime() - staleDays * 86_400_000);
  const [sales, stock, roots] = await Promise.all([
    db.$queryRaw<SalesRow[]>`
      WITH RECURSIVE ${treeCte(tenantId)},
      s AS (
        SELECT tree.root_id AS root,
               (${SALE_AT} >= ${ts(b.start)}) AS cur,
               ol.quantity AS qty,
               ${NET_LINE} AS net,
               ol."purchasePriceSnapshot" AS unit_cost,
               ${DAYS_TO_SELL} AS days
        FROM order_lines ol
        JOIN orders o ON o.id = ol."orderId" AND o."tenantId" = ${tenantId}
        LEFT JOIN products p ON p.id = ol."productId"
        LEFT JOIN tree ON tree.id = p."categoryId"
        WHERE ol."tenantId" = ${tenantId} AND o."paymentStatus" = 'PAID'
          AND ((${SALE_AT} >= ${ts(b.start)} AND ${SALE_AT} < ${ts(b.end)})
            OR (${SALE_AT} >= ${ts(b.prevStart)} AND ${SALE_AT} < ${ts(b.prevEnd)}))
      )
      SELECT (GROUPING(root) = 1) AS is_total, root, cur,
             COALESCE(SUM(qty), 0)::int AS sold,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS median_days,
             COALESCE(ROUND(SUM(net) FILTER (WHERE unit_cost IS NOT NULL)), 0)::bigint AS costed_revenue,
             COALESCE(SUM(unit_cost::bigint * qty), 0)::bigint AS cost
      FROM s
      GROUP BY GROUPING SETS ((root, cur), (cur))`,
    db.$queryRaw<StockRow[]>`
      WITH RECURSIVE ${treeCte(tenantId)}
      SELECT (GROUPING(tree.root_id) = 1) AS is_total, tree.root_id AS root,
        COALESCE(SUM(p.quantity) FILTER (WHERE p.status IN ('ACTIVE', 'RESERVED')), 0)::int AS in_stock,
        COALESCE(SUM(COALESCE(p."purchasePrice", 0)::bigint * p.quantity) FILTER (WHERE p.status IN ('ACTIVE', 'RESERVED')), 0)::bigint AS stock_cost,
        COALESCE(SUM(p.price::bigint * p.quantity) FILTER (WHERE p.status IN ('ACTIVE', 'RESERVED')), 0)::bigint AS stock_list,
        COUNT(*) FILTER (WHERE p.status IN ('ACTIVE', 'RESERVED') AND p.quantity > 0 AND p."purchasePrice" IS NULL)::int AS missing_cost,
        COALESCE(SUM(p.quantity) FILTER (WHERE p.status IN ('ACTIVE', 'RESERVED') AND COALESCE(p."publishedAt", p."createdAt") < ${ts(staleBefore)}), 0)::int AS tied_items,
        COALESCE(SUM(COALESCE(p."purchasePrice", 0)::bigint * p.quantity)
          FILTER (WHERE p.status IN ('ACTIVE', 'RESERVED') AND COALESCE(p."publishedAt", p."createdAt") < ${ts(staleBefore)}), 0)::bigint AS tied_cost,
        COUNT(*) FILTER (WHERE p."publishedAt" >= ${ts(b.start)} AND p."publishedAt" < ${ts(b.end)})::int AS listed,
        COUNT(*) FILTER (WHERE p."publishedAt" >= ${ts(b.start)} AND p."publishedAt" < ${ts(b.end)} AND p."soldAt" IS NOT NULL)::int AS listed_sold,
        COUNT(*) FILTER (WHERE p."publishedAt" >= ${ts(b.prevStart)} AND p."publishedAt" < ${ts(b.prevEnd)})::int AS listed_prev,
        COUNT(*) FILTER (WHERE p."publishedAt" >= ${ts(b.prevStart)} AND p."publishedAt" < ${ts(b.prevEnd)} AND p."soldAt" IS NOT NULL)::int AS listed_sold_prev
      FROM products p
      LEFT JOIN tree ON tree.id = p."categoryId"
      WHERE p."tenantId" = ${tenantId} AND p.status NOT IN ('DRAFT', 'STOLEN')
        AND (p.status IN ('ACTIVE', 'RESERVED') OR p."publishedAt" >= ${ts(b.prevStart)})
      GROUP BY GROUPING SETS ((tree.root_id), ())`,
    db.category.findMany({ where: { tenantId, parentId: null }, select: { id: true, title: true }, orderBy: [{ sortOrder: "asc" }, { title: "asc" }] }),
  ]);

  const salesOf = (total: boolean, root: string | null, cur: boolean) =>
    sales.find((r) => r.is_total === total && (total || r.root === root) && r.cur === cur);
  const margin = (r: SalesRow | undefined) => (r ? marginPct(n(r.costed_revenue), n(r.cost)) : null);
  const totalStock = stock.find((r) => r.is_total);
  const cur = salesOf(true, null, true);
  const prev = salesOf(true, null, false);

  const titles = new Map<string | null, string>(roots.map((r) => [r.id, r.title]));
  const keys = new Set<string | null>([...stock.filter((r) => !r.is_total).map((r) => r.root), ...sales.filter((r) => !r.is_total).map((r) => r.root)]);
  const categories: CategoryInsight[] = [...keys]
    .map((root) => {
      const st = stock.find((r) => !r.is_total && r.root === root);
      const sl = salesOf(false, root, true);
      return {
        id: root,
        title: (root != null ? titles.get(root) : null) ?? "Uncategorized",
        inStock: st?.in_stock ?? 0,
        sold: sl?.sold ?? 0,
        medianDays: num(sl?.median_days),
        marginPct: margin(sl),
        listed: st?.listed ?? 0,
        sellThrough: sellThrough(st?.listed ?? 0, st?.listed_sold ?? 0),
      };
    })
    .filter((c) => c.inStock > 0 || c.sold > 0 || c.listed > 0)
    .sort((a, b) => b.sold - a.sold || b.inStock - a.inStock || a.title.localeCompare(b.title));

  return {
    period,
    start: b.start.toISOString(),
    end: b.end.toISOString(),
    staleDays,
    kpis: {
      stockItems: totalStock?.in_stock ?? 0,
      stockCost: n(totalStock?.stock_cost),
      stockList: n(totalStock?.stock_list),
      stockMissingCost: totalStock?.missing_cost ?? 0,
      medianDays: num(cur?.median_days),
      medianDaysPrev: num(prev?.median_days),
      sold: cur?.sold ?? 0,
      soldPrev: prev?.sold ?? 0,
      marginPct: margin(cur),
      marginPctPrev: margin(prev),
      listed: totalStock?.listed ?? 0,
      listedSold: totalStock?.listed_sold ?? 0,
      sellThrough: sellThrough(totalStock?.listed ?? 0, totalStock?.listed_sold ?? 0),
      sellThroughPrev: sellThrough(totalStock?.listed_prev ?? 0, totalStock?.listed_sold_prev ?? 0),
      tiedItems: totalStock?.tied_items ?? 0,
      tiedCost: n(totalStock?.tied_cost),
    },
    categories,
  };
}

// ─── Buy more of these ──────────────────────────────────────────────────────

export type BuyMoreGroup = SalesGroup & { categoryId: string | null; facetValueId: string | null };
export type ZeroResultSearch = { query: string; searches: number; zeroResults: number };
export type BuyMore = { groups: BuyMoreGroup[]; zeroResults: ZeroResultSearch[] };

type FacetGroupRow = {
  root: string | null;
  value_id: string;
  value_name: string;
  sold: number;
  median_days: number | null;
  costed_revenue: bigint;
  cost: bigint;
  in_stock: number;
};

/**
 * Groups = top-level category × COUNTRY / PERIOD facet value (plus the category as a whole), from
 * sales in the period; picked with pickBuyMore against the shop's median days and margin.
 */
export async function loadBuyMore(tenantId: string, b: PeriodBounds, startDay: string, overview: InsightsOverview): Promise<BuyMore> {
  const [rows, searches] = await Promise.all([
    db.$queryRaw<FacetGroupRow[]>`
      WITH RECURSIVE ${treeCte(tenantId)},
      s AS (
        SELECT ol."productId" AS product_id, tree.root_id AS root, ol.quantity AS qty, ${NET_LINE} AS net,
               ol."purchasePriceSnapshot" AS unit_cost, ${DAYS_TO_SELL} AS days
        FROM order_lines ol
        JOIN orders o ON o.id = ol."orderId" AND o."tenantId" = ${tenantId}
        JOIN products p ON p.id = ol."productId"
        LEFT JOIN tree ON tree.id = p."categoryId"
        WHERE ol."tenantId" = ${tenantId} AND o."paymentStatus" = 'PAID'
          AND ${SALE_AT} >= ${ts(b.start)} AND ${SALE_AT} < ${ts(b.end)}
      ),
      g AS (
        SELECT s.root, fv.id AS value_id, MIN(fv.name) AS value_name,
               SUM(s.qty)::int AS sold,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY s.days) AS median_days,
               COALESCE(ROUND(SUM(s.net) FILTER (WHERE s.unit_cost IS NOT NULL)), 0)::bigint AS costed_revenue,
               COALESCE(SUM(s.unit_cost::bigint * s.qty), 0)::bigint AS cost
        FROM s
        JOIN product_facet_values pfv ON pfv."productId" = s.product_id
        JOIN facet_values fv ON fv.id = pfv."facetValueId"
        JOIN facets f ON f.id = fv."facetId" AND f.kind IN ('COUNTRY', 'PERIOD')
        GROUP BY s.root, fv.id
        HAVING SUM(s.qty) >= 3
      ),
      st AS (
        SELECT tree.root_id AS root, pfv."facetValueId" AS value_id, SUM(p.quantity)::int AS qty
        FROM products p
        JOIN product_facet_values pfv ON pfv."productId" = p.id
        LEFT JOIN tree ON tree.id = p."categoryId"
        WHERE p."tenantId" = ${tenantId} AND p.status IN ('ACTIVE', 'RESERVED')
          AND pfv."facetValueId" IN (SELECT value_id FROM g)
        GROUP BY 1, 2
      )
      SELECT g.root, g.value_id, g.value_name, g.sold, g.median_days, g.costed_revenue, g.cost, COALESCE(st.qty, 0)::int AS in_stock
      FROM g LEFT JOIN st ON st.value_id = g.value_id AND st.root IS NOT DISTINCT FROM g.root`,
    db.$queryRaw<{ query: string; searches: number; zero_results: number }[]>`
      SELECT query, SUM(searches)::int AS searches, SUM("zeroResults")::int AS zero_results
      FROM search_query_stats
      WHERE "tenantId" = ${tenantId} AND day >= ${startDay}::date
      GROUP BY query
      HAVING SUM("zeroResults") > 0
      ORDER BY zero_results DESC, searches DESC, query ASC
      LIMIT 6`,
  ]);

  const titles = new Map(overview.categories.map((c) => [c.id, c.title]));
  const facetGroups: BuyMoreGroup[] = rows.map((r) => {
    const cat = titles.get(r.root) ?? "Uncategorized";
    return {
      key: `${r.root ?? "-"}:${r.value_id}`,
      label: `${cat} · ${r.value_name}`,
      categoryId: r.root,
      facetValueId: r.value_id,
      sold: r.sold,
      medianDays: num(r.median_days),
      marginPct: marginPct(n(r.costed_revenue), n(r.cost)),
      inStock: r.in_stock,
    };
  });
  const categoryGroups: BuyMoreGroup[] = overview.categories.map((c) => ({
    key: `${c.id ?? "-"}`,
    label: c.title,
    categoryId: c.id,
    facetValueId: null,
    sold: c.sold,
    medianDays: c.medianDays,
    marginPct: c.marginPct,
    inStock: c.inStock,
  }));
  const picked = pickBuyMore([...facetGroups, ...categoryGroups], { medianDays: overview.kpis.medianDays, marginPct: overview.kpis.marginPct }, 8);
  // A specific group (category × facet) says more than its whole category: drop the duplicate.
  const groups = picked.filter((g) => g.facetValueId != null || !picked.some((o) => o.facetValueId != null && o.categoryId === g.categoryId)).slice(0, 5);
  return { groups, zeroResults: searches.map((s) => ({ query: s.query, searches: s.searches, zeroResults: s.zero_results })) };
}

// ─── Sitting too long ───────────────────────────────────────────────────────

/** Page views are kept this long (src/server/analytics pruneOldPageViews). */
const VIEW_RETENTION_DAYS = 400;
const STALE_LIMIT = 30;
const COMPARABLES_PER_ITEM = 12;

export type StaleItem = {
  id: string;
  stockCode: number;
  title: string;
  price: number;
  purchasePrice: number | null;
  categoryTitle: string | null;
  listedAt: string;
  daysListed: number;
  views: number | null;
  interest: number;
  reason: StaleReason;
  reprice: RepriceSuggestion | null;
  /** Another slow item in the same category to offer together. */
  bundleWith: { stockCode: number; title: string } | null;
};

export type StaleList = { total: number; totalCost: number; items: StaleItem[]; homePageId: string | null; nextFair: { id: string; name: string } | null };

type StaleRow = {
  id: string;
  stockCode: number;
  title: string;
  price: number;
  purchasePrice: number | null;
  categoryId: string | null;
  categoryTitle: string | null;
  root: string | null;
  listed_at: Date;
  wishlist: number;
  alerts: number;
  total: number;
  total_cost: bigint;
};

export async function loadStale(tenantId: string, staleDays: number, overview: InsightsOverview, now: Date): Promise<StaleList> {
  const staleBefore = new Date(now.getTime() - staleDays * 86_400_000);
  const [rows, homePage, nextFair] = await Promise.all([
    db.$queryRaw<StaleRow[]>`
      WITH RECURSIVE ${treeCte(tenantId)}
      SELECT p.id, p."stockCode", p.title, p.price, p."purchasePrice", p."categoryId", c.title AS "categoryTitle", tree.root_id AS root,
             COALESCE(p."publishedAt", p."createdAt") AS listed_at,
             (SELECT COUNT(*) FROM wishlist_items w WHERE w."productId" = p.id)::int AS wishlist,
             (SELECT COUNT(*) FROM alert_deliveries a WHERE a."productId" = p.id AND a.kind = 'SAVED_SEARCH')::int AS alerts,
             COUNT(*) OVER ()::int AS total,
             SUM(COALESCE(p."purchasePrice", 0)::bigint * p.quantity) OVER ()::bigint AS total_cost
      FROM products p
      LEFT JOIN categories c ON c.id = p."categoryId"
      LEFT JOIN tree ON tree.id = p."categoryId"
      WHERE p."tenantId" = ${tenantId} AND p.status = 'ACTIVE' AND p.quantity > 0
        AND COALESCE(p."publishedAt", p."createdAt") < ${ts(staleBefore)}
      ORDER BY listed_at ASC, p."stockCode" ASC
      LIMIT ${STALE_LIMIT}`,
    db.contentPage.findFirst({ where: { tenantId, systemKey: "HOME" }, select: { id: true } }),
    db.fair.findFirst({ where: { tenantId, status: "PREPARING" }, orderBy: { startsOn: "asc" }, select: { id: true, name: true } }),
  ]);
  if (rows.length === 0) return { total: 0, totalCost: 0, items: [], homePageId: homePage?.id ?? null, nextFair };

  const ids = rows.map((r) => r.id);
  const codes = rows.map((r) => String(r.stockCode));
  const viewsSince = new Date(now.getTime() - VIEW_RETENTION_DAYS * 86_400_000);
  const [views, anyViews, comparables] = await Promise.all([
    // Product pages are /product/{stockCode}/{slug}, optionally behind a locale prefix (/nl, /de).
    db.$queryRaw<{ code: string; views: number }[]>`
      SELECT v.code, COUNT(*)::int AS views
      FROM (
        SELECT substring(path from '^(?:/[a-z]{2})?/product/([0-9]{1,9})(?:/|$)') AS code
        FROM page_views
        WHERE "tenantId" = ${tenantId} AND "createdAt" >= ${ts(viewsSince)} AND path LIKE '%/product/%'
      ) v
      WHERE v.code = ANY(${codes}::text[])
      GROUP BY v.code`,
    db.pageView.findFirst({ where: { tenantId, createdAt: { gte: viewsSince } }, select: { id: true } }),
    // Comparable SOLD items: same category, sharing facet values with the item (at least two, or the
    // one it has), most overlap and most recent first. Sold price = the paid order line, else list price.
    db.$queryRaw<{ candidate: string; sold_price: number }[]>`
      SELECT c.id AS candidate, s.sold_price
      FROM products c
      CROSS JOIN LATERAL (SELECT array_agg("facetValueId") AS vals FROM product_facet_values WHERE "productId" = c.id) cv
      CROSS JOIN LATERAL (
        SELECT COALESCE(
                 (SELECT ol."unitPrice" FROM order_lines ol JOIN orders o ON o.id = ol."orderId"
                   WHERE ol."productId" = sp.id AND o."paymentStatus" = 'PAID'
                   ORDER BY o."placedAt" DESC LIMIT 1),
                 sp.price) AS sold_price
        FROM products sp
        CROSS JOIN LATERAL (SELECT COUNT(*)::int AS overlap FROM product_facet_values b
                             WHERE b."productId" = sp.id AND b."facetValueId" = ANY(cv.vals)) ov
        WHERE sp."tenantId" = ${tenantId} AND sp."categoryId" = c."categoryId" AND sp.status = 'SOLD' AND sp.id <> c.id
          AND ov.overlap >= LEAST(2, cardinality(cv.vals))
        ORDER BY ov.overlap DESC, sp."soldAt" DESC NULLS LAST
        LIMIT ${COMPARABLES_PER_ITEM}
      ) s
      WHERE c."tenantId" = ${tenantId} AND c.id = ANY(${ids}::text[]) AND c."categoryId" IS NOT NULL AND cardinality(cv.vals) > 0`,
  ]);

  const viewsByCode = new Map(views.map((v) => [v.code, v.views]));
  const compsBy = new Map<string, number[]>();
  for (const c of comparables) compsBy.set(c.candidate, [...(compsBy.get(c.candidate) ?? []), Number(c.sold_price)]);
  const medianByRoot = new Map(overview.categories.map((c) => [c.id, c.medianDays]));

  const items: StaleItem[] = rows.map((r) => {
    const daysListed = daysBetween(r.listed_at, now);
    const v = anyViews ? (viewsByCode.get(String(r.stockCode)) ?? 0) : null;
    const reprice = suggestReprice({ price: r.price, purchasePrice: r.purchasePrice, comparables: compsBy.get(r.id) ?? [] });
    const interest = r.wishlist + r.alerts;
    const reason = staleReason({
      views: v,
      viewDays: Math.min(daysListed, VIEW_RETENTION_DAYS),
      interest,
      categoryMedianDays: medianByRoot.get(r.root) ?? null,
      shopMedianDays: overview.kpis.medianDays,
      reprice,
    });
    const other = rows.find((o) => o.id !== r.id && o.categoryId != null && o.categoryId === r.categoryId);
    return {
      id: r.id,
      stockCode: r.stockCode,
      title: r.title,
      price: r.price,
      purchasePrice: r.purchasePrice,
      categoryTitle: r.categoryTitle,
      listedAt: new Date(r.listed_at).toISOString(),
      daysListed,
      views: v,
      interest,
      reason,
      reprice,
      bundleWith: other ? { stockCode: other.stockCode, title: other.title } : null,
    };
  });
  return { total: rows[0].total, totalCost: n(rows[0].total_cost), items, homePageId: homePage?.id ?? null, nextFair };
}
