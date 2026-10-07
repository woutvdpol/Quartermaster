import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { POST } from "@/app/api/collect/route";
import { resetCollectRateLimit, COLLECT_RATE_LIMIT } from "@/server/analytics/record";
import { pruneOldPageViews, visitorsSummary } from "@/server/analytics";
import { createTenantContext, resetDb } from "./helpers";

// In a Route Handler, next/headers reflects the incoming request; mirror that here.
const state = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => state.headers,
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

function post(body: unknown, opts: { host?: string; headers?: Record<string, string>; raw?: string } = {}) {
  const host = opts.host ?? "shop.test";
  const headers = new Headers({
    host,
    "user-agent": CHROME,
    "x-forwarded-for": "198.51.100.23",
    "content-type": "text/plain;charset=UTF-8",
    ...opts.headers,
  });
  state.headers = headers;
  return POST(new Request(`http://${host}/api/collect`, { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) }));
}

async function setup() {
  const ctx = await createTenantContext();
  await db.tenantDomain.create({ data: { tenantId: ctx.tenantId, host: "shop.test", isPrimary: true } });
  return ctx;
}

beforeEach(async () => {
  await resetDb();
  resetCollectRateLimit();
});

describe("POST /api/collect", () => {
  it("stores a cookieless page view without raw IP/UA", async () => {
    const ctx = await setup();
    const res = await post(
      { path: "/shop/helmets/?page=2&utm_source=forum#x", referrer: "https://www.forum.example/thread/1" },
      { headers: { "cf-ipcountry": "nl", origin: "http://shop.test", "sec-fetch-site": "same-origin" } },
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toBeNull();

    const rows = await db.pageView.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: ctx.tenantId,
      path: "/shop/helmets?utm_source=forum",
      referrerHost: "forum.example",
      countryCode: "NL",
    });
    expect(rows[0].visitorHash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(rows[0], (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain("198.51.100.23");

    // Same visitor, same day → same hash.
    await post({ path: "/" });
    const hashes = new Set((await db.pageView.findMany()).map((r) => r.visitorHash));
    expect(hashes.size).toBe(1);
  });

  it("ignores unknown hosts, bots, admin/api paths, cross-site posts and other providers", async () => {
    const ctx = await setup();
    expect((await post({ path: "/" }, { host: "unknown.test" })).status).toBe(204);
    expect((await post({ path: "/" }, { headers: { "user-agent": "curl/8.0" } })).status).toBe(204);
    expect((await post({ path: "/admin/orders" })).status).toBe(204);
    expect((await post({ path: "/api/collect" })).status).toBe(204);
    expect((await post({ path: "/" }, { headers: { origin: "https://evil.example" } })).status).toBe(204);
    expect((await post({ path: "/" }, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(204);
    expect(await db.pageView.count()).toBe(0);

    await db.setting.create({
      data: { tenantId: ctx.tenantId, group: "analytics", data: { provider: "matomo", matomoUrl: "https://m.example", matomoSiteId: 1 } },
    });
    expect((await post({ path: "/" })).status).toBe(204);
    expect(await db.pageView.count()).toBe(0);
  });

  it("ignores suspended tenants", async () => {
    const ctx = await setup();
    await db.tenant.update({ where: { id: ctx.tenantId }, data: { status: "SUSPENDED" } });
    await post({ path: "/" });
    expect(await db.pageView.count()).toBe(0);
  });

  it("rejects malformed and oversized bodies", async () => {
    await setup();
    expect((await post(null, { raw: "{not json" })).status).toBe(400);
    expect((await post(null, { raw: "[1]" })).status).toBe(400);
    expect((await post(null, { raw: JSON.stringify({ path: "/" + "a".repeat(5000) }) })).status).toBe(413);
  });

  it("rate-limits per IP", async () => {
    await setup();
    for (let i = 0; i < COLLECT_RATE_LIMIT.limit; i++) await post({ path: `/p${i}` });
    expect((await post({ path: "/over" })).status).toBe(429);
    expect((await post({ path: "/other-ip" }, { headers: { "x-forwarded-for": "198.51.100.99" } })).status).toBe(204);
    expect(await db.pageView.count()).toBe(COLLECT_RATE_LIMIT.limit + 1);
  });
});

describe("visitorsSummary / retention", () => {
  it("summarizes own page views per tenant", async () => {
    const ctx = await setup();
    const other = await createTenantContext();
    const now = new Date();
    const ago = (ms: number) => new Date(now.getTime() - ms);
    await db.pageView.createMany({
      data: [
        { tenantId: ctx.tenantId, path: "/shop", visitorHash: "v1", referrerHost: "google.com", createdAt: ago(60_000) },
        { tenantId: ctx.tenantId, path: "/shop?utm_source=x", visitorHash: "v1", createdAt: ago(30_000) },
        { tenantId: ctx.tenantId, path: "/p/1", visitorHash: "v2", referrerHost: "google.com", createdAt: ago(20 * 60_000) },
        { tenantId: ctx.tenantId, path: "/old", visitorHash: "v3", createdAt: ago(40 * 86_400_000) },
        { tenantId: other.tenantId, path: "/shop", visitorHash: "x", createdAt: ago(1000) },
      ],
    });

    const s = (await visitorsSummary(ctx, { days: 7 }))!;
    expect(s.provider).toBe("own");
    expect(s.series).toHaveLength(7);
    expect(s.series.reduce((n, d) => n + d.pageviews, 0)).toBe(3);
    expect(s.totals).toEqual({ pageviews: 3, visitors: 2 });
    expect(s.topPages[0]).toEqual({ path: "/shop", pageviews: 2, visitors: 1 });
    expect(s.topReferrers).toEqual([{ host: "google.com", pageviews: 2, visitors: 2 }]);
    expect(s.liveVisitors).toBe(1);

    const tz = (await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } })).timezone;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
    expect(s.series.at(-1)!.date).toBe(today);
  });

  it("prunes page views beyond the retention window", async () => {
    const ctx = await setup();
    await db.pageView.createMany({
      data: [
        { tenantId: ctx.tenantId, path: "/a", visitorHash: "v", createdAt: new Date(Date.now() - 401 * 86_400_000) },
        { tenantId: ctx.tenantId, path: "/b", visitorHash: "v", createdAt: new Date(Date.now() - 10 * 86_400_000) },
      ],
    });
    expect(await pruneOldPageViews()).toBe(1);
    expect((await db.pageView.findMany()).map((p) => p.path)).toEqual(["/b"]);
  });
});
