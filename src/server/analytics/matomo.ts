import "server-only";
import type { AnalyticsSummary } from "./types";

/*
 * Matomo adapter: same AnalyticsSummary shape as own analytics, read through the Matomo Reporting API.
 *
 * Security: the API token is a platform secret (env MATOMO_TOKEN), while `analytics.matomoUrl` is a
 * tenant-editable setting. To keep an OWNER from pointing the URL at their own server and harvesting
 * the token (or using us for SSRF), requests only go to the platform-configured MATOMO_URL, and only
 * when the tenant's matomoUrl has the same origin. Redirects are refused.
 *
 * Failures (unconfigured, HTTP/API errors, timeouts, odd payloads) return null; results are cached
 * 5 minutes per (site, range), failures 1 minute.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
const TIMEOUT_MS = 5000;
const TOP_N = 10;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const cache = new Map<string, { expires: number; value: AnalyticsSummary | null }>();

/** @internal tests */
export function clearMatomoCache() {
  cache.clear();
}

export type MatomoOptions = {
  /** Tenant setting `analytics.matomoUrl`. */
  matomoUrl: string | null;
  siteId: number | null;
  days: number;
  timezone: string;
  /** Overrides for tests; default env MATOMO_URL / MATOMO_TOKEN and global fetch. */
  env?: { url?: string; token?: string };
  fetchImpl?: FetchLike;
};

/** Resolves the API endpoint, or null when the tenant URL is not on the platform Matomo origin. */
export function matomoEndpoint(tenantUrl: string | null, platformUrl: string | undefined): string | null {
  if (!tenantUrl || !platformUrl) return null;
  try {
    const platform = new URL(platformUrl);
    const tenant = new URL(tenantUrl);
    if (platform.protocol !== "https:" || tenant.origin !== platform.origin) return null;
    const base = platform.href.replace(/index\.php$/, "").replace(/\/?$/, "/");
    return new URL("index.php", base).href;
  } catch {
    return null;
  }
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);

class MatomoError extends Error {}

async function call(endpoint: string, token: string, fetchImpl: FetchLike, params: Record<string, string>): Promise<unknown> {
  const body = new URLSearchParams({ module: "API", format: "JSON", ...params, token_auth: token });
  const res = await fetchImpl(endpoint, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new MatomoError(`HTTP ${res.status}`);
  const json: unknown = await res.json();
  if (json && typeof json === "object" && !Array.isArray(json) && (json as Row).result === "error") {
    throw new MatomoError(String((json as Row).message ?? "API error"));
  }
  return json;
}

function pathFromRow(row: Row): string | null {
  if (typeof row.url === "string") {
    try {
      const u = new URL(row.url);
      return u.pathname || "/";
    } catch {
      /* fall through */
    }
  }
  if (typeof row.label !== "string" || !row.label) return null;
  const label = row.label.trim();
  return label.startsWith("/") ? label : `/${label}`;
}

export async function matomoSummary(opts: MatomoOptions): Promise<AnalyticsSummary | null> {
  const endpoint = matomoEndpoint(opts.matomoUrl, opts.env?.url ?? process.env.MATOMO_URL);
  const token = opts.env?.token ?? process.env.MATOMO_TOKEN;
  if (!endpoint || !token || !opts.siteId) return null;

  const key = `${endpoint}|${opts.siteId}|${opts.days}|${opts.timezone}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const fetchImpl = opts.fetchImpl ?? (fetch as FetchLike);
  const site = { idSite: String(opts.siteId) };
  const daily = { ...site, period: "day", date: `last${opts.days}` };
  const range = { ...site, period: "range", date: `last${opts.days}` };

  let value: AnalyticsSummary | null = null;
  try {
    const [visits, actions, live, pages, referrers] = await Promise.all([
      call(endpoint, token, fetchImpl, { method: "VisitsSummary.get", ...daily }),
      // Optional: exact page views per day (VisitsSummary nb_actions also counts downloads/outlinks).
      call(endpoint, token, fetchImpl, { method: "Actions.get", ...daily }).catch(() => null),
      call(endpoint, token, fetchImpl, { method: "Live.getCounters", ...site, lastMinutes: "5" }),
      call(endpoint, token, fetchImpl, { method: "Actions.getPageUrls", ...range, flat: "1", filter_limit: String(TOP_N), filter_sort_column: "nb_hits", filter_sort_order: "desc" }),
      call(endpoint, token, fetchImpl, { method: "Referrers.getWebsites", ...range, filter_limit: String(TOP_N) }).catch(() => []),
    ]);

    if (!visits || typeof visits !== "object" || Array.isArray(visits)) throw new MatomoError("Unexpected VisitsSummary payload");
    const actionsByDay = actions && typeof actions === "object" && !Array.isArray(actions) ? (actions as Record<string, unknown>) : {};

    const series = Object.keys(visits as Row)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .map((date) => {
        const v = (visits as Record<string, unknown>)[date];
        const day = v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
        const a = actionsByDay[date];
        const act = a && typeof a === "object" && !Array.isArray(a) ? (a as Row) : null;
        return {
          date,
          visitors: num(day.nb_uniq_visitors ?? day.nb_visits),
          pageviews: act && act.nb_pageviews !== undefined ? num(act.nb_pageviews) : num(day.nb_actions),
        };
      });

    const liveRow = Array.isArray(live) && live[0] && typeof live[0] === "object" ? (live[0] as Row) : {};
    const topPages = (Array.isArray(pages) ? (pages as Row[]) : [])
      .map((r) => ({ path: pathFromRow(r), pageviews: num(r.nb_hits), visitors: num(r.nb_visits) }))
      .filter((r): r is { path: string; pageviews: number; visitors: number } => r.path !== null)
      .slice(0, TOP_N);
    const topReferrers = (Array.isArray(referrers) ? (referrers as Row[]) : [])
      .filter((r) => typeof r.label === "string" && r.label)
      .map((r) => ({ host: String(r.label).toLowerCase(), visitors: num(r.nb_visits), pageviews: num(r.nb_actions ?? r.nb_visits) }))
      .slice(0, TOP_N);

    value = {
      provider: "matomo",
      days: opts.days,
      timezone: opts.timezone,
      totals: {
        visitors: series.reduce((s, d) => s + d.visitors, 0),
        pageviews: series.reduce((s, d) => s + d.pageviews, 0),
      },
      series,
      topPages,
      topReferrers,
      liveVisitors: num(liveRow.visitors),
    };
  } catch (err) {
    console.warn(`[matomo] summary for site ${opts.siteId} failed:`, err instanceof Error ? err.message : err);
    value = null;
  }

  cache.set(key, { expires: Date.now() + (value ? CACHE_TTL_MS : FAILURE_TTL_MS), value });
  return value;
}
