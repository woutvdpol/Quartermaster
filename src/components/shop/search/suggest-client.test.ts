import { describe, expect, it, vi } from "vitest";
import { createSuggestClient, normalizeQuery } from "./suggest-client";

const body = (q: string) => ({ query: q, products: [], facets: [], categories: [], total: 0, totalCapped: false });

function fakeFetch() {
  const calls: { url: string; signal: AbortSignal }[] = [];
  const pending: (() => void)[] = [];
  const fn = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, signal: init!.signal! });
    return new Promise<Response>((resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      pending.push(() => resolve(new Response(JSON.stringify(body(new URL(url, "http://x").searchParams.get("q")!)), { status: 200 })));
    });
  });
  return { fn, calls, flush: () => pending.splice(0).forEach((r) => r()) };
}

describe("suggest client", () => {
  it("normalises queries", () => {
    expect(normalizeQuery("  duitse   helm ")).toBe("duitse helm");
    expect(normalizeQuery("x".repeat(150))).toHaveLength(100);
  });

  it("aborts the older request when a newer query starts", async () => {
    const f = fakeFetch();
    const client = createSuggestClient({ fetchFn: f.fn as unknown as typeof fetch });
    const first = client.get("hel");
    const second = client.get("helm");
    expect(f.calls[0].signal.aborted).toBe(true);
    f.flush();
    expect(await first).toBeNull();
    expect((await second)?.query).toBe("helm");
    expect(f.calls[1].url).toBe("/api/search/suggest?q=helm");
  });

  it("serves repeated queries from the cache (case/space-insensitive)", async () => {
    const f = fakeFetch();
    const client = createSuggestClient({ fetchFn: f.fn as unknown as typeof fetch });
    const p = client.get("Duitse helm");
    f.flush();
    await p;
    expect(client.peek(" duitse  HELM ")?.query).toBe("Duitse helm");
    expect(await client.get("duitse helm")).toMatchObject({ query: "Duitse helm" });
    expect(f.fn).toHaveBeenCalledTimes(1);
  });

  it("returns null on HTTP errors (rate limit) without caching", async () => {
    const fn = vi.fn(async () => new Response("{}", { status: 429 }));
    const client = createSuggestClient({ fetchFn: fn as unknown as typeof fetch });
    expect(await client.get("helm")).toBeNull();
    expect(client.peek("helm")).toBeUndefined();
  });
});
