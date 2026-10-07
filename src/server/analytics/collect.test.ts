import { describe, expect, it } from "vitest";
import {
  MemoryRateLimiter,
  basePath,
  countryFromHeaders,
  dailySalt,
  isBot,
  localDateKey,
  normalizePath,
  referrerHost,
  visitorHash,
} from "./collect";

const KEY = Buffer.alloc(32, 9);
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("visitor hash", () => {
  const base = { ip: "203.0.113.7", userAgent: CHROME, tenantId: "t1", timeZone: "Europe/Amsterdam", key: KEY };

  it("is stable within a local day and rotates on the next one", () => {
    const morning = visitorHash({ ...base, at: new Date("2026-10-07T06:00:00Z") });
    const evening = visitorHash({ ...base, at: new Date("2026-10-07T21:30:00Z") }); // 23:30 in Amsterdam
    const nextDay = visitorHash({ ...base, at: new Date("2026-10-07T22:30:00Z") }); // 00:30 next day in Amsterdam
    expect(morning).toMatch(/^[0-9a-f]{32}$/);
    expect(evening).toBe(morning);
    expect(nextDay).not.toBe(morning);
  });

  it("differs per tenant, IP and user agent", () => {
    const at = new Date("2026-10-07T12:00:00Z");
    const h = visitorHash({ ...base, at });
    expect(visitorHash({ ...base, at, tenantId: "t2" })).not.toBe(h);
    expect(visitorHash({ ...base, at, ip: "203.0.113.8" })).not.toBe(h);
    expect(visitorHash({ ...base, at, userAgent: IPHONE })).not.toBe(h);
  });

  it("depends on the secret key (salt is derived, never stored)", () => {
    const at = new Date("2026-10-07T12:00:00Z");
    expect(visitorHash({ ...base, at, key: Buffer.alloc(32, 1) })).not.toBe(visitorHash({ ...base, at }));
    expect(dailySalt("2026-10-07", KEY).equals(dailySalt("2026-10-07", KEY))).toBe(true);
    expect(dailySalt("2026-10-07", KEY).equals(dailySalt("2026-10-08", KEY))).toBe(false);
  });

  it("formats local dates", () => {
    expect(localDateKey(new Date("2026-10-07T22:30:00Z"), "Europe/Amsterdam")).toBe("2026-10-08");
    expect(localDateKey(new Date("2026-10-07T22:30:00Z"), "UTC")).toBe("2026-10-07");
  });
});

describe("bot filter", () => {
  it("lets real browsers through", () => {
    expect(isBot(CHROME)).toBe(false);
    expect(isBot(IPHONE)).toBe(false);
    expect(isBot("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe(false);
  });

  it.each([
    [null],
    [""],
    ["curl/8.4.0"],
    ["python-requests/2.32"],
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    ["Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36"],
    ["Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0 Mobile Safari/537.36 Chrome-Lighthouse"],
    ["facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)"],
    ["Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)"],
  ])("rejects %s", (ua) => {
    expect(isBot(ua)).toBe(true);
  });
});

describe("path normalization", () => {
  it.each([
    ["/", "/"],
    ["/shop/", "/shop"],
    ["/shop//item-1", "/shop/item-1"],
    ["/shop?page=2&sort=price", "/shop"],
    ["/shop?utm_source=news&x=1&utm_medium=mail#top", "/shop?utm_source=news&utm_medium=mail"],
    ["/p?UTM_Campaign=Fall", "/p?utm_campaign=Fall"],
    ["https://shop.example/product/abc?email=a@b.c", "/product/abc"],
    ["/product/abc#reviews", "/product/abc"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it.each([["/admin"], ["/admin/orders"], ["/API/collect"], ["/_next/static/x.js"], ["/uploads/t/x.webp"], ["shop"], ["//evil.com/x"], ["javascript:alert(1)"], [""], [42], [null]])(
    "rejects %s",
    (input) => {
      expect(normalizePath(input)).toBeNull();
    },
  );

  it("does not exclude look-alike prefixes", () => {
    expect(normalizePath("/administration-guide")).toBe("/administration-guide");
  });

  it("caps the length", () => {
    expect(normalizePath(`/${"a".repeat(1500)}`)!.length).toBe(500);
  });

  it("basePath strips the query", () => {
    expect(basePath("/shop?utm_source=x")).toBe("/shop");
    expect(basePath("/shop")).toBe("/shop");
  });
});

describe("referrer and country", () => {
  it("keeps external hosts, drops internal and invalid referrers", () => {
    expect(referrerHost("https://www.Google.com/search?q=helmet", "shop.example")).toBe("google.com");
    expect(referrerHost("https://shop.example/shop", "shop.example")).toBeNull();
    expect(referrerHost("https://www.shop.example/", "shop.example:3000")).toBeNull();
    expect(referrerHost("android-app://com.google.android.gm", "shop.example")).toBeNull();
    expect(referrerHost("not a url", "shop.example")).toBeNull();
    expect(referrerHost("", "shop.example")).toBeNull();
  });

  it("reads CDN country headers", () => {
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "nl" }))).toBe("NL");
    expect(countryFromHeaders(new Headers({ "x-vercel-ip-country": "DE" }))).toBe("DE");
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "XX" }))).toBeNull();
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "T1" }))).toBeNull();
    expect(countryFromHeaders(new Headers())).toBeNull();
  });
});

describe("MemoryRateLimiter", () => {
  it("limits per key per window", () => {
    const rl = new MemoryRateLimiter(2, 1000);
    expect(rl.take("a", 0)).toBe(true);
    expect(rl.take("a", 10)).toBe(true);
    expect(rl.take("a", 20)).toBe(false);
    expect(rl.take("b", 20)).toBe(true);
    expect(rl.take("a", 1000)).toBe(true);
  });

  it("stays bounded under a flood of keys", () => {
    const rl = new MemoryRateLimiter(1, 1000, 3);
    for (let i = 0; i < 10; i++) expect(rl.take(`k${i}`, 0)).toBe(true);
  });
});
