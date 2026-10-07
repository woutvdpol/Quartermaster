import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function run(path: string, init: { headers?: Record<string, string> } = {}) {
  return proxy(new NextRequest(`http://shop.test${path}`, { headers: { host: "shop.test", ...init.headers } }));
}

/** Request header as forwarded to the app by NextResponse.next({ request: { headers } }). */
function forwarded(res: Response, name: string) {
  return res.headers.get(`x-middleware-request-${name}`);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy CSP", () => {
  it("is report-only by default, with the same nonce on response and forwarded request", () => {
    vi.stubEnv("CSP_MODE", "");
    const res = run("/shop");
    const policy = res.headers.get("content-security-policy-report-only");
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain("frame-ancestors 'self'");
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("reporting-endpoints")).toBe('csp-endpoint="/api/csp-report"');
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");

    const nonce = /'nonce-([^']+)'/.exec(policy!)?.[1];
    expect(nonce).toBeTruthy();
    expect(forwarded(res, "content-security-policy-report-only")).toBe(policy);
    expect(forwarded(res, "x-nonce")).toBe(nonce);
  });

  it("uses a fresh nonce per request", () => {
    const a = run("/").headers.get("content-security-policy-report-only");
    const b = run("/").headers.get("content-security-policy-report-only");
    expect(a).not.toBe(b);
  });

  it("enforces when CSP_MODE=enforce; admin is never framed", () => {
    vi.stubEnv("CSP_MODE", "enforce");
    const res = run("/admin/login");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(forwarded(res, "content-security-policy")).toBe(res.headers.get("content-security-policy"));
  });

  it("sets no CSP when CSP_MODE=off and drops client-supplied CSP request headers", () => {
    vi.stubEnv("CSP_MODE", "off");
    const res = run("/", { headers: { "content-security-policy": "script-src 'nonce-evil'", "x-nonce": "evil" } });
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
    expect(forwarded(res, "content-security-policy")).toBeNull();
    expect(forwarded(res, "x-nonce")).toBeNull();
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("puts the CSP on the admin login redirect too", () => {
    vi.stubEnv("CSP_MODE", "report-only");
    const res = run("/admin/orders");
    expect(res.status).toBe(307);
    expect(res.headers.get("content-security-policy-report-only")).toContain("frame-ancestors 'none'");
  });
});
