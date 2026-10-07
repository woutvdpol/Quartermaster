import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { ServiceError, type ServiceContext } from "@/server/context";
import { AuthError, canAccessTenant } from "@/server/auth/guards";
import { parseInput } from "@/server/catalog/errors";
import { getSettings } from "@/server/settings";
import { matomoSummary } from "./matomo";
import type { AnalyticsSummary } from "./types";

export type { AnalyticsSummary } from "./types";

const TOP_N = 10;
const summarySchema = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) });

/**
 * Visitor statistics for the dashboard. Dispatches on `settings.analytics.provider`:
 * "matomo" → Matomo API (null when Matomo is unreachable/misconfigured); otherwise own page views
 * ("none" still shows whatever was collected before tracking was switched off).
 */
export async function visitorsSummary(ctx: ServiceContext, input: z.input<typeof summarySchema> = {}): Promise<AnalyticsSummary | null> {
  if (!canAccessTenant(ctx.actor, ctx.tenantId)) throw new AuthError("FORBIDDEN");
  const { days } = parseInput(summarySchema, input);
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { id: true, timezone: true } });
  if (!tenant) throw new ServiceError("NOT_FOUND", "Tenant not found");
  const settings = await getSettings(tenant.id, "analytics");

  if (settings.provider === "matomo") {
    return matomoSummary({ matomoUrl: settings.matomoUrl, siteId: settings.matomoSiteId, days, timezone: tenant.timezone });
  }
  return ownSummary(tenant.id, tenant.timezone, days);
}

/** Own cookieless analytics over the last `days` local days (today included) in `tz`. */
export async function ownSummary(tenantId: string, tz: string, days: number): Promise<AnalyticsSummary> {
  const back = days - 1;
  // Range start = local midnight `back` days ago in `tz`, converted back to the UTC wall clock that
  // `createdAt` (timestamp without time zone, written as UTC) uses. Repeated per query with bound params.

  const [series, totals, topPages, topReferrers, live] = await Promise.all([
    db.$queryRaw<{ date: string; pageviews: number; visitors: number }[]>`
      WITH bounds AS (
        SELECT date_trunc('day', now() AT TIME ZONE ${tz}::text) AS today_local
      ),
      v AS (
        SELECT date_trunc('day', (pv."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}::text) AS day,
               COUNT(*)::int AS pageviews, COUNT(DISTINCT pv."visitorHash")::int AS visitors
        FROM page_views pv, bounds b
        WHERE pv."tenantId" = ${tenantId}
          AND pv."createdAt" >= ((b.today_local - make_interval(days => ${back}::int)) AT TIME ZONE ${tz}::text) AT TIME ZONE 'UTC'
        GROUP BY 1
      )
      SELECT to_char(d, 'YYYY-MM-DD') AS date, COALESCE(v.pageviews, 0)::int AS pageviews, COALESCE(v.visitors, 0)::int AS visitors
      FROM bounds b,
           generate_series(b.today_local - make_interval(days => ${back}::int), b.today_local, interval '1 day') AS d
      LEFT JOIN v ON v.day = d
      ORDER BY d`,
    db.$queryRaw<{ pageviews: number; visitors: number }[]>`
      SELECT COUNT(*)::int AS pageviews, COUNT(DISTINCT "visitorHash")::int AS visitors
      FROM page_views
      WHERE "tenantId" = ${tenantId}
        AND "createdAt" >= ((date_trunc('day', now() AT TIME ZONE ${tz}::text) - make_interval(days => ${back}::int)) AT TIME ZONE ${tz}::text) AT TIME ZONE 'UTC'`,
    db.$queryRaw<{ path: string; pageviews: number; visitors: number }[]>`
      SELECT split_part(path, '?', 1) AS path, COUNT(*)::int AS pageviews, COUNT(DISTINCT "visitorHash")::int AS visitors
      FROM page_views
      WHERE "tenantId" = ${tenantId}
        AND "createdAt" >= ((date_trunc('day', now() AT TIME ZONE ${tz}::text) - make_interval(days => ${back}::int)) AT TIME ZONE ${tz}::text) AT TIME ZONE 'UTC'
      GROUP BY 1 ORDER BY pageviews DESC, path ASC LIMIT ${TOP_N}`,
    db.$queryRaw<{ host: string; pageviews: number; visitors: number }[]>`
      SELECT "referrerHost" AS host, COUNT(*)::int AS pageviews, COUNT(DISTINCT "visitorHash")::int AS visitors
      FROM page_views
      WHERE "tenantId" = ${tenantId} AND "referrerHost" IS NOT NULL
        AND "createdAt" >= ((date_trunc('day', now() AT TIME ZONE ${tz}::text) - make_interval(days => ${back}::int)) AT TIME ZONE ${tz}::text) AT TIME ZONE 'UTC'
      GROUP BY 1 ORDER BY visitors DESC, pageviews DESC, host ASC LIMIT ${TOP_N}`,
    db.$queryRaw<{ live: number }[]>`
      SELECT COUNT(DISTINCT "visitorHash")::int AS live
      FROM page_views
      WHERE "tenantId" = ${tenantId} AND "createdAt" >= (now() AT TIME ZONE 'UTC') - interval '5 minutes'`,
  ]);

  return {
    provider: "own",
    days,
    timezone: tz,
    // Hashes rotate per local day, so distinct-over-range equals the sum of daily uniques.
    totals: { pageviews: totals[0]?.pageviews ?? 0, visitors: totals[0]?.visitors ?? 0 },
    series,
    topPages,
    topReferrers,
    liveVisitors: live[0]?.live ?? 0,
  };
}

/** Retention for the cron: deletes page views older than `days` in batches. Returns the number deleted. */
export async function pruneOldPageViews(days = 400): Promise<number> {
  const d = parseInput(z.number().int().min(1).max(10_000), days);
  let total = 0;
  for (;;) {
    const deleted = await db.$executeRaw`
      DELETE FROM page_views WHERE id IN (
        SELECT id FROM page_views
        WHERE "createdAt" < (now() AT TIME ZONE 'UTC') - make_interval(days => ${d}::int)
        LIMIT 10000)`;
    total += deleted;
    if (deleted < 10000) return total;
  }
}
