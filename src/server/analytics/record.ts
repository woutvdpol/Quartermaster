import "server-only";
import { db } from "@/server/db";
import { getRequestScope, normalizeHost } from "@/server/tenant";
import { getSettings } from "@/server/settings";
import {
  MemoryRateLimiter,
  clientIp,
  countryFromHeaders,
  isBot,
  normalizePath,
  referrerHost,
  visitorHash,
} from "./collect";

/*
 * POST /api/collect handler logic. Every "ignored" outcome answers 204 like a stored one, so the
 * endpoint does not reveal which hosts are shops or what is being filtered.
 */

const MAX_BODY_BYTES = 4096;
/** Page views per IP per minute (per server instance). */
export const COLLECT_RATE_LIMIT = { limit: 60, windowMs: 60_000 };
const limiter = new MemoryRateLimiter(COLLECT_RATE_LIMIT.limit, COLLECT_RATE_LIMIT.windowMs);

/** @internal tests */
export function resetCollectRateLimit() {
  limiter.reset();
}

export type CollectOutcome =
  | "stored"
  | "ignored_host"
  | "ignored_provider"
  | "ignored_bot"
  | "ignored_path"
  | "ignored_cross_site"
  | "rate_limited"
  | "bad_request"
  | "too_large";

const noContent = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function handleCollect(request: Request): Promise<{ response: Response; outcome: CollectOutcome }> {
  const h = request.headers;
  const done = (outcome: CollectOutcome, response: Response = noContent()) => ({ response, outcome });

  const declared = Number(h.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return done("too_large", new Response(null, { status: 413 }));

  // Browsers send these on fetch/sendBeacon; a mismatch means another site is posting views.
  const host = normalizeHost(h.get("host"));
  const origin = h.get("origin");
  if (h.get("sec-fetch-site") === "cross-site") return done("ignored_cross_site");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = normalizeHost(new URL(origin).host);
    } catch {
      /* "null" origin etc. */
    }
    if (!originHost || originHost !== host) return done("ignored_cross_site");
  }

  const userAgent = h.get("user-agent");
  if (isBot(userAgent)) return done("ignored_bot");

  const ip = clientIp(h);
  if (!limiter.take(`ip:${ip ?? "unknown"}`)) {
    return done("rate_limited", new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return done("too_large", new Response(null, { status: 413 }));
    body = JSON.parse(text);
  } catch {
    return done("bad_request", new Response(null, { status: 400 }));
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return done("bad_request", new Response(null, { status: 400 }));
  const { path: rawPath, referrer } = body as { path?: unknown; referrer?: unknown };

  const scope = await getRequestScope();
  if (scope.kind !== "tenant") return done("ignored_host");
  const tenant = scope.tenant;

  const path = normalizePath(rawPath);
  if (!path) return done("ignored_path");

  const analytics = await getSettings(tenant.id, "analytics");
  if (analytics.provider !== "own") return done("ignored_provider");

  const now = new Date();
  await db.pageView.create({
    data: {
      tenantId: tenant.id,
      path,
      referrerHost: referrerHost(referrer, host),
      countryCode: countryFromHeaders(h),
      visitorHash: visitorHash({ ip, userAgent, tenantId: tenant.id, at: now, timeZone: tenant.timezone }),
      createdAt: now,
    },
  });
  return done("stored");
}
