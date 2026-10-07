import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { db } from "@/server/db";
import { POST } from "@/app/api/csp-report/route";
import { CSP_REPORT_MAX_BYTES, CSP_REPORT_RATE_LIMIT } from "@/server/security/csp-report";
import { resetDb } from "./helpers";

const REPORT = {
  "csp-report": {
    "document-uri": "https://shop.test/account?token=secret",
    "effective-directive": "script-src-elem",
    "blocked-uri": "https://evil.example/x.js",
    "script-sample": "secret-sample",
  },
};

function post(body: string, opts: { type?: string; ip?: string; length?: string } = {}) {
  const headers = new Headers({
    host: "shop.test",
    "content-type": opts.type ?? "application/csp-report",
    "x-forwarded-for": opts.ip ?? "198.51.100.7",
  });
  if (opts.length) headers.set("content-length", opts.length);
  return POST(new Request("http://shop.test/api/csp-report", { method: "POST", headers, body }));
}

let warn: MockInstance<typeof console.warn>;
beforeEach(async () => {
  await resetDb();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("POST /api/csp-report", () => {
  it("logs one compact line per violation, without query strings or samples", async () => {
    const res = await post(JSON.stringify(REPORT));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toBe("[csp] report script-src-elem blocked=https://evil.example doc=/account");
    expect(line).not.toContain("secret");
  });

  it("accepts the Reporting API format", async () => {
    const body = JSON.stringify([
      { type: "csp-violation", url: "https://shop.test/", body: { documentURL: "https://shop.test/", effectiveDirective: "img-src", blockedURL: "https://cdn.example/a.png", disposition: "report" } },
    ]);
    const res = await post(body, { type: "application/reports+json" });
    expect(res.status).toBe(204);
    expect(warn.mock.calls.map((c) => c[0])).toEqual(["[csp] report img-src blocked=https://cdn.example doc=/"]);
  });

  it("rejects other content types, oversized and malformed bodies", async () => {
    expect((await post(JSON.stringify(REPORT), { type: "text/plain" })).status).toBe(415);
    expect((await post("x", { length: String(CSP_REPORT_MAX_BYTES + 1) })).status).toBe(413);
    // No/false Content-Length: the stream itself is capped.
    expect((await post("x".repeat(CSP_REPORT_MAX_BYTES + 10))).status).toBe(413);
    expect((await post("{not json")).status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rate-limits per client IP (atomic take)", async () => {
    const body = JSON.stringify(REPORT);
    for (let i = 0; i < CSP_REPORT_RATE_LIMIT.limit; i++) expect((await post(body)).status).toBe(204);
    expect((await post(body)).status).toBe(429);
    expect((await post(body, { ip: "198.51.100.8" })).status).toBe(204);
    expect(await db.rateLimitHit.count({ where: { key: "csp-report:198.51.100.7" } })).toBe(CSP_REPORT_RATE_LIMIT.limit);
  });
});
