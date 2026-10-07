import { beforeEach, describe, expect, it, vi } from "vitest";

// next/navigation control flow: throw recognisable errors instead of Next's internal ones.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  permanentRedirect: (to: string) => {
    throw new Error(`308 ${to}`);
  },
  redirect: (to: string) => {
    throw new Error(`307 ${to}`);
  },
}));
const shop = vi.hoisted(() => ({ current: null as null | { tenant: { id: string } } }));
vi.mock("@/server/storefront/context", () => ({ getShopContext: async () => shop.current }));
const lookup = vi.hoisted(() => ({
  resolveRedirect: vi.fn(),
  recordRedirectHits: vi.fn(),
}));
vi.mock("./lookup", () => lookup);

import { redirectOrNotFound, searchString } from "./runtime";

const outcome = (p: Promise<unknown>) => p.then(() => "returned", (e: Error) => e.message);

describe("redirectOrNotFound", () => {
  beforeEach(() => {
    shop.current = { tenant: { id: "t1" } };
    lookup.resolveRedirect.mockReset();
    lookup.recordRedirectHits.mockReset();
  });

  it("404s off shop hosts without looking anything up", async () => {
    shop.current = null;
    expect(await outcome(redirectOrNotFound("/basket"))).toBe("NOT_FOUND");
    expect(lookup.resolveRedirect).not.toHaveBeenCalled();
  });

  it("redirects 301 rows permanently (308) and 302 rows temporarily (307), counting hits", async () => {
    lookup.resolveRedirect.mockResolvedValueOnce({ target: "/new", statusCode: 301, ids: ["r1"] });
    expect(await outcome(redirectOrNotFound("/old", { utm_source: "x", page: ["1", "2"] }))).toBe("308 /new");
    expect(lookup.resolveRedirect).toHaveBeenCalledWith("t1", "/old?utm_source=x&page=1&page=2");
    expect(lookup.recordRedirectHits).toHaveBeenCalledWith(["r1"]);

    lookup.resolveRedirect.mockResolvedValueOnce({ target: "/sale", statusCode: 302, ids: ["r2"] });
    expect(await outcome(redirectOrNotFound("/promo"))).toBe("307 /sale");
  });

  it("tries candidates in order, then 404s", async () => {
    lookup.resolveRedirect.mockResolvedValueOnce(null).mockResolvedValueOnce({ target: "/shop", statusCode: 301, ids: [] });
    expect(await outcome(redirectOrNotFound(["/product/12/old", "/product/12"]))).toBe("308 /shop");
    expect(lookup.resolveRedirect.mock.calls.map((c) => c[1])).toEqual(["/product/12/old", "/product/12"]);

    lookup.resolveRedirect.mockResolvedValue(null);
    expect(await outcome(redirectOrNotFound("/gone"))).toBe("NOT_FOUND");
  });

  it("searchString rebuilds the query", () => {
    expect(searchString(undefined)).toBe("");
    expect(searchString({})).toBe("");
    expect(searchString({ a: "1", b: undefined, c: ["x", "y"] })).toBe("?a=1&c=x&c=y");
    expect(searchString(new URLSearchParams("code=5"))).toBe("?code=5");
  });
});
