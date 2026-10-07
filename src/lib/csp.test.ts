import { describe, expect, it } from "vitest";
import { buildCsp, createNonce, cspHeaderName, parseCspMode, reportingEndpointsHeader } from "./csp";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );
}

describe("parseCspMode", () => {
  it("defaults to report-only", () => {
    expect(parseCspMode(undefined)).toBe("report-only");
    expect(parseCspMode("")).toBe("report-only");
    expect(parseCspMode("nonsense")).toBe("report-only");
    expect(parseCspMode("report-only")).toBe("report-only");
  });
  it("accepts enforce and off (case/whitespace-insensitive)", () => {
    expect(parseCspMode(" Enforce ")).toBe("enforce");
    expect(parseCspMode("OFF")).toBe("off");
  });
});

describe("createNonce", () => {
  it("is base64 of 16 random bytes and unique", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
  });
});

describe("buildCsp", () => {
  const shop = directives(buildCsp({ nonce: "abc123", area: "shop" }));
  const admin = directives(buildCsp({ nonce: "abc123", area: "admin" }));

  it("uses a nonce with strict-dynamic and no unsafe-inline/eval for scripts", () => {
    expect(shop.get("script-src")).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'", "https://challenges.cloudflare.com"]);
    expect(shop.get("script-src")).not.toContain("'unsafe-inline'");
    expect(shop.get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("adds unsafe-eval only in development", () => {
    expect(directives(buildCsp({ nonce: "n", area: "shop", dev: true })).get("script-src")).toContain("'unsafe-eval'");
  });

  it("has the hardening directives", () => {
    for (const d of [shop, admin]) {
      expect(d.get("default-src")).toEqual(["'self'"]);
      expect(d.get("object-src")).toEqual(["'none'"]);
      expect(d.get("base-uri")).toEqual(["'self'"]);
      expect(d.get("form-action")).toEqual(["'self'", "https://www.mollie.com"]);
      expect(d.get("frame-src")).toEqual(["'self'", "https://challenges.cloudflare.com"]);
      expect(d.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
      expect(d.get("font-src")).toEqual(["'self'"]);
      expect(d.get("connect-src")).toEqual(["'self'"]);
      expect(d.get("report-uri")).toEqual(["/api/csp-report"]);
      expect(d.get("report-to")).toEqual(["csp-endpoint"]);
    }
  });

  it("mirrors X-Frame-Options per area", () => {
    expect(shop.get("frame-ancestors")).toEqual(["'self'"]);
    expect(admin.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("allows external https images only in the admin (newsletter preview)", () => {
    expect(shop.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(admin.get("img-src")).toEqual(["'self'", "data:", "blob:", "https:"]);
  });
});

describe("headers", () => {
  it("picks the header name per mode", () => {
    expect(cspHeaderName("enforce")).toBe("Content-Security-Policy");
    expect(cspHeaderName("report-only")).toBe("Content-Security-Policy-Report-Only");
  });
  it("declares the reporting endpoint", () => {
    expect(reportingEndpointsHeader()).toBe('csp-endpoint="/api/csp-report"');
  });
});
