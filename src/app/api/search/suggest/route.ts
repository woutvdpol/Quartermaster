import type { NextRequest } from "next/server";
import { clientIpFromHeaders } from "@/server/request-meta";
import { searchRequestContext, suggest, toPublicCards } from "@/server/search";
import type { SearchErrorResponse, SuggestResponse } from "@/server/search/api-types";
import { allowSuggest } from "@/server/search/throttle";
import { suggestWhy, matchCategories } from "@/server/search/ui-labels";
import { MAX_QUERY_LENGTH, SHOP_PATH, catalogQueryString, categoryHref, getCategoryTree, parseCatalogParams } from "@/server/storefront-catalog";

/*
 * Search-as-you-type for the header search: GET /api/search/suggest?q=duitse%20hel
 * Shop hosts only (404 on the platform host and while the shop is "coming soon" for visitors).
 * Per-visitor results (compliance by country, sensitive items locked for guests) → private, no-store.
 * Throttled per IP in memory (30 requests / 10 s) — a DB-backed limiter would cost more than the
 * query itself; abuse beyond that is the ingress rate limit's job.
 */

const headers = { "Cache-Control": "private, no-store" };

function error(status: number, body: SearchErrorResponse) {
  return Response.json(body, { status, headers });
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  const ctx = await searchRequestContext();
  if (!ctx) return error(404, { error: "not_found", message: "Not found" });
  if (!allowSuggest(clientIpFromHeaders(request.headers) ?? "unknown")) return error(429, { error: "rate_limited", message: "Too many requests" });

  const empty = { original: "", text: "", facets: [], min: null, max: null, status: null, sort: null, stockCode: null, chips: [], relaxed: false };
  if (q.length < 2) {
    return Response.json({ query: q, interpretation: { ...empty, original: q }, facets: [], categories: [], products: [], total: 0, totalCapped: false, searchHref: SHOP_PATH, timing: { totalMs: 0, semantic: "skipped" } } satisfies SuggestResponse, { headers });
  }
  const tenantId = ctx.shop.tenant.id;
  const [res, tree] = await Promise.all([suggest(tenantId, q, { scope: ctx.scope, currency: ctx.shop.tenant.currency }), getCategoryTree(tenantId)]);
  const base = parseCatalogParams({ q });
  const cards = await toPublicCards(ctx, res.products);
  const body: SuggestResponse = {
    query: res.query,
    interpretation: res.interpretation,
    facets: res.facets.map((f) => ({ ...f, href: `${SHOP_PATH}${catalogQueryString({ ...base, q: null, facets: [f.token] })}` })),
    categories: matchCategories(tree, res.interpretation.text || q, categoryHref),
    products: cards.map((c) => ({ ...c, why: suggestWhy(res.reasons[c.id] ?? "lexical", res.interpretation, c.title) })),
    total: res.total,
    totalCapped: res.totalCapped,
    searchHref: `${SHOP_PATH}${catalogQueryString(base)}`,
    timing: res.timing,
  };
  return Response.json(body, { headers: { ...headers, "Server-Timing": `search;dur=${res.timing.totalMs}` } });
}
