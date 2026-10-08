import { afterEach, describe, expect, it, vi } from "vitest";
import { Batcher, OverloadedError } from "@/embedder/batcher";
import { HttpEmbedder, EmbedderUnavailableError } from "./http-embedder";
import { searchMetrics } from "./metrics";

describe("Batcher (embedder service)", () => {
  it("merges concurrent requests into one batch and splits the results back", async () => {
    const calls: string[][] = [];
    const b = new Batcher<string, string>(async (items) => {
      calls.push(items);
      return items.map((i) => i.toUpperCase());
    }, { maxBatch: 10, maxWaitMs: 5, maxQueue: 100 });
    const [a, c] = await Promise.all([b.push(["a", "b"]), b.push(["c"])]);
    expect(a).toEqual(["A", "B"]);
    expect(c).toEqual(["C"]);
    expect(calls).toEqual([["a", "b", "c"]]);
  });

  it("caps batch size and runs one batch at a time", async () => {
    let running = 0;
    let maxRunning = 0;
    const sizes: number[] = [];
    const b = new Batcher<number, number>(async (items) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      sizes.push(items.length);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return items;
    }, { maxBatch: 3, maxWaitMs: 1, maxQueue: 100 });
    const out = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((n) => b.push([n])));
    expect(out.flat()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(maxRunning).toBe(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(3);
  });

  it("refuses work beyond the queue limit and propagates model errors", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const b = new Batcher<number, number>(async () => {
      await gate;
      throw new Error("boom");
    }, { maxBatch: 2, maxWaitMs: 1, maxQueue: 2 });
    const first = b.push([1, 2]); // full batch: starts at once, blocks on the gate
    const second = b.push([3]); // waits in the queue (1 of 2)
    await expect(b.push([4, 5])).rejects.toBeInstanceOf(OverloadedError);
    release();
    await expect(first).rejects.toThrow("boom");
    await expect(second).rejects.toThrow("boom");
  });
});

describe("HttpEmbedder", () => {
  afterEach(() => vi.useRealTimers());

  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

  it("sends the token and kind, returns vectors", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      const body = JSON.parse(String(init?.body)) as { kind: string; texts: string[] };
      expect(body.kind).toBe("query");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer secret");
      return ok({ model: "e5", dim: 384, vectors: [new Array(384).fill(0.1)] });
    });
    const e = new HttpEmbedder({ url: "http://embedder:3100/", token: "secret", fetch: fetchMock as unknown as typeof fetch });
    const v = await e.embedQuery("helm");
    expect(v).toHaveLength(384);
    expect(fetchMock.mock.calls[0][0]).toBe("http://embedder:3100/embed/text");
  });

  it("opens the circuit on a timeout: status cold, lexical fallback, logged once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = searchMetrics.timeouts;
    const slow = vi.fn(
      (url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })))),
    );
    const e = new HttpEmbedder({ url: "http://embedder:3100", token: "t", queryTimeoutMs: 20, fetch: slow as unknown as typeof fetch });
    expect(e.status("text")).toBe("ready");
    await expect(e.embedQuery("helm")).rejects.toBeInstanceOf(EmbedderUnavailableError);
    expect(e.status("text")).toBe("cold");
    expect(e.status("image")).toBe("cold");
    await expect(e.embedQuery("helm")).rejects.toBeInstanceOf(EmbedderUnavailableError);
    expect(searchMetrics.timeouts - before).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("treats 5xx/401 as down but a 4xx (bad photo) as the caller's problem", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = (status: number) => vi.fn(async () => new Response("{}", { status }));
    const bad = new HttpEmbedder({ url: "http://e", token: "t", fetch: res(422) as unknown as typeof fetch });
    await expect(bad.embedImage({ data: new Uint8Array(12), width: 2, height: 2 })).rejects.toThrow("422");
    expect(bad.status("image")).toBe("ready");
    const down = new HttpEmbedder({ url: "http://e", token: "t", fetch: res(503) as unknown as typeof fetch });
    await expect(down.embedImageQuery("x")).rejects.toThrow("503");
    expect(down.status("imageText")).toBe("cold");
  });

  it("rejects vectors of the wrong dimension (model mismatch)", async () => {
    const e = new HttpEmbedder({ url: "http://e", token: "t", fetch: (async () => ok({ model: "other", dim: 512, vectors: [[1]] })) as unknown as typeof fetch });
    await expect(e.embedQuery("x")).rejects.toThrow("unexpected vectors");
  });
});
