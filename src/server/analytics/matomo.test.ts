import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearMatomoCache, matomoEndpoint, matomoSummary } from "./matomo";

const env = { url: "https://stats.quartermaster.test/", token: "secret-token" };
const base = { matomoUrl: "https://stats.quartermaster.test", siteId: 3, days: 2, timezone: "Europe/Amsterdam", env };

function fakeMatomo(overrides: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = {
    "VisitsSummary.get": { "2026-10-06": { nb_uniq_visitors: 4, nb_visits: 5, nb_actions: 12 }, "2026-10-07": [] },
    "Actions.get": { "2026-10-06": { nb_pageviews: 10 }, "2026-10-07": [] },
    "Live.getCounters": [{ visits: 2, actions: 3, visitors: 2 }],
    "Actions.getPageUrls": [
      { label: "/shop", nb_hits: 6, nb_visits: 4, url: "https://shop.example/shop?x=1" },
      { label: "product/abc", nb_hits: 3, nb_visits: 2 },
    ],
    "Referrers.getWebsites": [{ label: "Forum.example", nb_visits: 2, nb_actions: 5 }],
    ...overrides,
  };
  const calls: { url: string; body: URLSearchParams; redirect?: string }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const body = init.body as URLSearchParams;
    calls.push({ url, body, redirect: init.redirect });
    const method = body.get("method")!;
    const value = responses[method];
    if (value instanceof Error) throw value;
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { fetchImpl, calls };
}

beforeEach(clearMatomoCache);

describe("matomoEndpoint", () => {
  it("only allows the platform origin over https", () => {
    expect(matomoEndpoint("https://stats.quartermaster.test/x", env.url)).toBe("https://stats.quartermaster.test/index.php");
    expect(matomoEndpoint("https://evil.example", env.url)).toBeNull();
    expect(matomoEndpoint("https://stats.quartermaster.test", "http://stats.quartermaster.test")).toBeNull();
    expect(matomoEndpoint("https://stats.quartermaster.test", undefined)).toBeNull();
    expect(matomoEndpoint(null, env.url)).toBeNull();
  });
});

describe("matomoSummary", () => {
  it("maps the Matomo API into the shared summary shape", async () => {
    const { fetchImpl, calls } = fakeMatomo();
    const s = await matomoSummary({ ...base, fetchImpl });
    expect(s).toEqual({
      provider: "matomo",
      days: 2,
      timezone: "Europe/Amsterdam",
      totals: { visitors: 4, pageviews: 10 },
      series: [
        { date: "2026-10-06", visitors: 4, pageviews: 10 },
        { date: "2026-10-07", visitors: 0, pageviews: 0 },
      ],
      topPages: [
        { path: "/shop", pageviews: 6, visitors: 4 },
        { path: "/product/abc", pageviews: 3, visitors: 2 },
      ],
      topReferrers: [{ host: "forum.example", visitors: 2, pageviews: 5 }],
      liveVisitors: 2,
    });
    // Token goes in the POST body, never the URL; redirects refused.
    for (const c of calls) {
      expect(c.url).toBe("https://stats.quartermaster.test/index.php");
      expect(c.body.get("token_auth")).toBe("secret-token");
      expect(c.redirect).toBe("error");
    }
  });

  it("caches results", async () => {
    const { fetchImpl } = fakeMatomo();
    await matomoSummary({ ...base, fetchImpl });
    const n = fetchImpl.mock.calls.length;
    await matomoSummary({ ...base, fetchImpl });
    expect(fetchImpl.mock.calls.length).toBe(n);
  });

  it("returns null on API errors, a foreign URL or missing config", async () => {
    const err = fakeMatomo({ "VisitsSummary.get": { result: "error", message: "nope" } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await matomoSummary({ ...base, fetchImpl: err.fetchImpl })).toBeNull();

    const foreign = fakeMatomo();
    expect(await matomoSummary({ ...base, matomoUrl: "https://attacker.example", fetchImpl: foreign.fetchImpl })).toBeNull();
    expect(foreign.fetchImpl).not.toHaveBeenCalled();

    expect(await matomoSummary({ ...base, env: { url: env.url, token: "" }, fetchImpl: foreign.fetchImpl })).toBeNull();
    expect(await matomoSummary({ ...base, siteId: null, fetchImpl: foreign.fetchImpl })).toBeNull();
  });

  it("tolerates a failing optional report", async () => {
    const { fetchImpl } = fakeMatomo({ "Referrers.getWebsites": new Error("down"), "Actions.get": new Error("down") });
    const s = await matomoSummary({ ...base, fetchImpl });
    expect(s?.topReferrers).toEqual([]);
    expect(s?.totals.pageviews).toBe(12); // falls back to nb_actions
  });
});
