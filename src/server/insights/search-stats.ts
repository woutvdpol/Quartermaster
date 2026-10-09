import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { db } from "@/server/db";
import { isBot } from "@/server/analytics/collect";
import { localDay, normaliseSearchQuery } from "./pure";

/*
 * Shop search statistics (docs/insights.md): one row per tenant, local day and normalised query with
 * the number of searches and how many found nothing. No visitor data. Feeds "Buy more of these"
 * (searches nobody could find anything for).
 *
 * Recorded once per full search results page (src/components/shop/catalog/CatalogView.tsx), never
 * for search-as-you-type suggestions, further pages or "load more". The write runs after the
 * response is sent (`after`), so it never slows the search; failures are only logged.
 */

export type ShopSearchEvent = {
  tenantId: string;
  timeZone: string;
  query: string;
  /** Number of results the visitor got (0 = nothing found). */
  results: number;
  userAgent: string | null;
  at?: Date;
};

/** Upserts the daily aggregate. Returns false when the search is not counted (bot, short, stock number). */
export async function recordShopSearch(e: ShopSearchEvent): Promise<boolean> {
  const query = normaliseSearchQuery(e.query);
  if (!query || isBot(e.userAgent)) return false;
  const day = localDay(e.at ?? new Date(), e.timeZone);
  const zero = e.results === 0 ? 1 : 0;
  await db.$executeRaw`
    INSERT INTO search_query_stats (id, "tenantId", day, query, searches, "zeroResults")
    VALUES (${randomUUID()}, ${e.tenantId}, ${day}::date, ${query}, 1, ${zero})
    ON CONFLICT ("tenantId", day, query)
    DO UPDATE SET searches = search_query_stats.searches + 1, "zeroResults" = search_query_stats."zeroResults" + EXCLUDED."zeroResults"`;
  return true;
}

/** Fire-and-forget variant for request handlers / server components: runs after the response. */
export function recordShopSearchLater(e: ShopSearchEvent): void {
  // Cheap checks first, so bots and stock-number lookups don't even schedule work.
  if (!normaliseSearchQuery(e.query) || isBot(e.userAgent)) return;
  const at = e.at ?? new Date();
  after(() => recordShopSearch({ ...e, at }).catch((err) => console.error("[insights] search stat failed:", err)));
}
