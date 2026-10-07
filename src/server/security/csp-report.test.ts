import { describe, expect, it, vi } from "vitest";

// Pure parsing tests; the DB-backed limiter is covered by tests/integration/csp-report.int.test.ts.
vi.mock("@/server/auth/rate-limit", () => ({ take: async () => true }));

import { blockedOrigin, documentPath, formatViolation, parseCspReports } from "./csp-report";

describe("parseCspReports", () => {
  it("reads application/csp-report (report-uri)", () => {
    const v = parseCspReports({
      "csp-report": {
        "document-uri": "https://shop.test/account/orders?token=secret#x",
        "violated-directive": "script-src-elem",
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://evil.example/x.js?a=1",
        "script-sample": "alert(document.cookie)",
      },
    });
    expect(v).toEqual([{ disposition: "report", directive: "script-src-elem", blocked: "https://evil.example", path: "/account/orders" }]);
    expect(formatViolation(v[0])).toBe("[csp] report script-src-elem blocked=https://evil.example doc=/account/orders");
  });

  it("reads application/reports+json (Reporting API), ignoring other report types", () => {
    const v = parseCspReports([
      { type: "deprecation", body: { id: "x" } },
      {
        type: "csp-violation",
        url: "https://shop.test/cart",
        body: { documentURL: "https://shop.test/cart?x=1", effectiveDirective: "script-src-elem", blockedURL: "inline", disposition: "enforce" },
      },
    ]);
    expect(v).toEqual([{ disposition: "enforce", directive: "script-src-elem", blocked: "inline", path: "/cart" }]);
  });

  it("keeps only the directive name from old-style violated-directive values", () => {
    const [v] = parseCspReports({ "csp-report": { "violated-directive": "img-src 'self' data:", "blocked-uri": "data", "document-uri": "x" } });
    expect(v.directive).toBe("img-src");
    expect(v.path).toBe("-");
  });

  it("caps the number of reports per request and ignores junk", () => {
    const one = { type: "csp-violation", body: { documentURL: "https://a.test/", effectiveDirective: "img-src", blockedURL: "https://b.test/x" } };
    expect(parseCspReports(Array.from({ length: 50 }, () => one))).toHaveLength(10);
    expect(parseCspReports(null)).toEqual([]);
    expect(parseCspReports("x")).toEqual([]);
    expect(parseCspReports({ "csp-report": 5 })).toEqual([]);
    expect(parseCspReports([null, 1, { type: "csp-violation" }])).toEqual([]);
  });
});

describe("blockedOrigin / documentPath", () => {
  it("reduces URLs to origins and keeps scheme/keywords short", () => {
    expect(blockedOrigin("https://x.test:8443/a?b")).toBe("https://x.test:8443");
    expect(blockedOrigin("data:image/png;base64,AAAA")).toBe("data");
    expect(blockedOrigin("blob:https://x.test/uuid")).toBe("blob");
    expect(blockedOrigin("eval")).toBe("eval");
    expect(blockedOrigin("")).toBe("-");
    expect(blockedOrigin("in line\n[csp] fake")).toBe("inlinecspfake");
  });
  it("never returns query strings", () => {
    expect(documentPath("https://x.test/reset-password?token=abc")).toBe("/reset-password");
  });
});
