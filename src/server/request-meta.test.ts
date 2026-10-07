import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, isSameOrigin, normalizeIp, requestHost, trustedProxyHops } from "./request-meta";

const h = (init: Record<string, string>) => new Headers(init);

describe("trustedProxyHops", () => {
  it("defaults to 0 and rejects garbage", () => {
    expect(trustedProxyHops({})).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "" })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "-1" })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "1.5" })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "yes" })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: " 2 " })).toBe(2);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "99" })).toBe(10);
  });
});

describe("clientIpFromHeaders", () => {
  it("trusts nothing with 0 hops (X-Forwarded-For and X-Real-IP are client-controlled)", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.8" }), 0)).toBeNull();
  });

  it("takes the right-most entry behind one proxy (ingress-nginx appends the socket address)", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "203.0.113.7" }), 1)).toBe("203.0.113.7");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "6.6.6.6, 1.1.1.1 ,203.0.113.7" }), 1)).toBe("203.0.113.7");
  });

  it("takes the N-th from the right behind N proxies, never a forged left part", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.2" }), 2)).toBe("203.0.113.7");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "10.0.0.2" }), 2)).toBeNull(); // chain too short
  });

  it("ignores X-Real-IP and missing headers", () => {
    expect(clientIpFromHeaders(h({ "x-real-ip": "203.0.113.8" }), 1)).toBeNull();
    expect(clientIpFromHeaders(h({}), 1)).toBeNull();
  });

  it("returns null for non-IP garbage instead of using it as a rate-limit key", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.1.1.1, not-an-ip" }), 1)).toBeNull();
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.1.1.1, " + "9".repeat(500) }), 1)).toBeNull();
  });

  it("reads the hop count from the environment by default", () => {
    const prev = process.env.TRUSTED_PROXY_HOPS;
    try {
      process.env.TRUSTED_PROXY_HOPS = "1";
      expect(clientIpFromHeaders(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7");
      process.env.TRUSTED_PROXY_HOPS = "0";
      expect(clientIpFromHeaders(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.TRUSTED_PROXY_HOPS;
      else process.env.TRUSTED_PROXY_HOPS = prev;
    }
  });
});

describe("normalizeIp", () => {
  it("canonicalizes", () => {
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIp("203.0.113.7:51234")).toBe("203.0.113.7");
    expect(normalizeIp("[2001:DB8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
    expect(normalizeIp("unknown")).toBeNull();
    expect(normalizeIp("")).toBeNull();
  });
});

describe("host + same-origin", () => {
  it("uses Host only, never X-Forwarded-Host", () => {
    expect(requestHost(h({ host: "Shop.Example.", "x-forwarded-host": "evil.test" }))).toBe("shop.example");
  });

  it("isSameOrigin compares Origin with Host", () => {
    const req = (headers: Record<string, string>) => ({ headers: h(headers) });
    expect(isSameOrigin(req({ host: "shop.test", origin: "https://shop.test" }))).toBe(true);
    expect(isSameOrigin(req({ host: "shop.test:3000", origin: "http://shop.test:3000" }))).toBe(true);
    expect(isSameOrigin(req({ host: "shop.test", origin: "https://evil.test", "x-forwarded-host": "evil.test" }))).toBe(false);
    expect(isSameOrigin(req({ host: "shop.test" }))).toBe(false);
    expect(isSameOrigin(req({ host: "shop.test", origin: "null" }))).toBe(false);
  });
});
