import { afterEach, describe, expect, it, vi } from "vitest";
import { visitorCountry } from "@/server/compliance/country";
import { countryForIp, resetIpCountryForTests } from "./ip-country";

describe("countryForIp (local IP-country database)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetIpCountryForTests();
  });

  it("maps public IPv4 and IPv6 addresses to ISO-2 countries", () => {
    expect(countryForIp("8.8.8.8")).toBe("US");
    expect(countryForIp("193.0.6.139")).toBe("NL"); // RIPE NCC, Amsterdam
    expect(countryForIp("2001:67c:2e8::1")).toBe("NL");
  });

  it("returns null for private, loopback and missing addresses", () => {
    expect(countryForIp("127.0.0.1")).toBeNull();
    expect(countryForIp("10.1.2.3")).toBeNull();
    expect(countryForIp(null)).toBeNull();
  });

  it("can be switched off and survives a missing database file", () => {
    vi.stubEnv("GEOIP", "off");
    expect(countryForIp("8.8.8.8")).toBeNull();
    resetIpCountryForTests();
    vi.stubEnv("GEOIP", "");
    vi.stubEnv("GEOIP_DB", "/nonexistent.mmdb");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(countryForIp("8.8.8.8")).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("compliance visitorCountry", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers the edge header over the IP lookup", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(visitorCountry(new Headers({ "cf-ipcountry": "DE", "x-forwarded-for": "8.8.8.8" }))).toBe("DE");
  });

  it("falls back to the client IP from the trusted proxy chain", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(visitorCountry(new Headers({ "x-forwarded-for": "6.6.6.6, 193.0.6.139" }))).toBe("NL");
  });

  it("ignores X-Forwarded-For when no proxy is trusted", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    expect(visitorCountry(new Headers({ "x-forwarded-for": "193.0.6.139" }))).toBeNull();
  });
});
