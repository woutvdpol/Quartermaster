import { afterEach, describe, expect, it, vi } from "vitest";
import { TURNSTILE_VERIFY_URL, turnstileTokenFrom, verifyTurnstile } from "./verify";

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

afterEach(() => vi.restoreAllMocks());

describe("verifyTurnstile", () => {
  it("allows a valid token and posts secret, token and ip", async () => {
    const fetchImpl = mockFetch({ success: true, action: "sell" });
    const res = await verifyTurnstile("tok", "1.2.3.4", { secret: "s3cret", fetchImpl, action: "sell" });
    expect(res).toEqual({ ok: true, reason: "verified" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe("s3cret");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });

  it("denies a rejected token and passes the error codes", async () => {
    const fetchImpl = mockFetch({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await verifyTurnstile("bad", null, { secret: "s", fetchImpl })).toEqual({
      ok: false,
      reason: "rejected",
      errorCodes: ["invalid-input-response"],
    });
  });

  it("denies a missing token without calling Cloudflare", async () => {
    const fetchImpl = mockFetch({ success: true });
    expect(await verifyTurnstile("", null, { secret: "s", fetchImpl })).toMatchObject({ ok: false, reason: "missing-token" });
    expect(await verifyTurnstile(null, null, { secret: "s", fetchImpl })).toMatchObject({ ok: false, reason: "missing-token" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("denies on action mismatch", async () => {
    const fetchImpl = mockFetch({ success: true, action: "login" });
    expect(await verifyTurnstile("t", null, { secret: "s", fetchImpl, action: "sell" })).toMatchObject({ ok: false, reason: "action-mismatch" });
  });

  it("fails closed on network errors and non-2xx", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await verifyTurnstile("t", null, { secret: "s", fetchImpl: throwing })).toMatchObject({ ok: false, reason: "unavailable" });
    expect(await verifyTurnstile("t", null, { secret: "s", fetchImpl: mockFetch({}, 500) })).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("allows without a secret in development (no fetch)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = mockFetch({ success: false });
    expect(await verifyTurnstile(null, null, { secret: null, nodeEnv: "development", fetchImpl })).toEqual({ ok: true, reason: "not-configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("denies without a secret in production and logs an error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await verifyTurnstile("t", null, { secret: null, nodeEnv: "production", fetchImpl: mockFetch({ success: true }) })).toEqual({
      ok: false,
      reason: "not-configured",
    });
    expect(err).toHaveBeenCalled();
  });
});

describe("turnstileTokenFrom", () => {
  it("reads the widget field", () => {
    const fd = new FormData();
    expect(turnstileTokenFrom(fd)).toBeNull();
    fd.set("cf-turnstile-response", "abc");
    expect(turnstileTokenFrom(fd)).toBe("abc");
  });
});
