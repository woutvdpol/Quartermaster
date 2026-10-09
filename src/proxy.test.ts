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

describe("proxy shop languages", () => {
  it("rewrites /de/x to /x with the locale request header, keeping the query", () => {
    const res = run("/de/shop?q=helm");
    expect(res.headers.get("x-middleware-rewrite")).toBe("http://shop.test/shop?q=helm");
    expect(forwarded(res, "x-qm-locale")).toBe("de");
    // CSP/nonce still forwarded on rewritten requests.
    expect(forwarded(res, "x-nonce")).toBeTruthy();
  });

  it("rewrites the bare prefix to the home page", () => {
    const res = run("/nl");
    expect(res.headers.get("x-middleware-rewrite")).toBe("http://shop.test/");
    expect(forwarded(res, "x-qm-locale")).toBe("nl");
  });

  it("serves English without prefix and never trusts a client-supplied locale header", () => {
    const res = run("/shop", { headers: { "x-qm-locale": "de" } });
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(forwarded(res, "x-qm-locale")).toBeNull();
  });

  it("redirects the English prefix to the unprefixed URL", () => {
    const res = run("/en/cart?x=1");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("http://shop.test/cart?x=1");
  });

  it("does not localise admin, API or file paths", () => {
    for (const path of ["/de/admin", "/de/api/health", "/nl/uploads/a.jpg", "/de/sitemap.xml"]) {
      const res = run(path);
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
      expect(forwarded(res, "x-qm-locale")).toBeNull();
    }
  });

  it("does not touch look-alike first segments", () => {
    const res = run("/design");
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
