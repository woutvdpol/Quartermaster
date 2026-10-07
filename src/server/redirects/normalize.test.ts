import { describe, expect, it } from "vitest";
import { normalizeRedirectPath, redirectPathOnly } from "./normalize";

describe("normalizeRedirectPath", () => {
  it("adds a leading slash, drops trailing slashes and lower-cases", () => {
    expect(normalizeRedirectPath("Over-Ons/")).toBe("/over-ons");
    expect(normalizeRedirectPath("/Shop/Category/Medals///")).toBe("/shop/category/medals");
    expect(normalizeRedirectPath("/")).toBe("/");
    expect(normalizeRedirectPath("///")).toBeNull(); // protocol-relative look-alike
    expect(normalizeRedirectPath("  /a//b  ")).toBe("/a/b");
  });

  it("strips scheme, host and fragment of full URLs", () => {
    expect(normalizeRedirectPath("https://www.concept500.nl/Product/123/Helmet?x=1#top")).toBe("/product/123/helmet?x=1");
    expect(normalizeRedirectPath("http://old.example/")).toBe("/");
    expect(normalizeRedirectPath("/page#section")).toBe("/page");
  });

  it("keeps a cleaned, sorted query (tracking params and empty values dropped)", () => {
    expect(normalizeRedirectPath("/shop.php?code=123")).toBe("/shop.php?code=123");
    expect(normalizeRedirectPath("/shop.php?utm_source=fb&CODE=123&fbclid=x")).toBe("/shop.php?code=123");
    expect(normalizeRedirectPath("/x?b=2&a=1")).toBe("/x?a=1&b=2");
    expect(normalizeRedirectPath("/x?")).toBe("/x");
    expect(normalizeRedirectPath("/x?empty=&gclid=1")).toBe("/x");
    expect(normalizeRedirectPath("/x?a=1", { keepQuery: false })).toBe("/x");
  });

  it("decodes safe percent-escapes so encoded and plain forms match", () => {
    expect(normalizeRedirectPath("/shop/tag/World%20War%20II")).toBe("/shop/tag/world war ii");
    expect(normalizeRedirectPath("/caf%C3%A9")).toBe("/café");
    expect(normalizeRedirectPath("/a%2Fb")).toBe("/a%2fb"); // reserved stays encoded
    expect(normalizeRedirectPath("/bad%zz")).toBe("/bad%zz");
  });

  it("rejects things that are not same-shop paths", () => {
    expect(normalizeRedirectPath("")).toBeNull();
    expect(normalizeRedirectPath("   ")).toBeNull();
    expect(normalizeRedirectPath("//evil.example/x")).toBeNull();
    expect(normalizeRedirectPath("javascript:alert(1)")).toBeNull();
    expect(normalizeRedirectPath("ftp://x/y")).toBeNull();
    expect(normalizeRedirectPath("/a\tb")).toBeNull();
    expect(normalizeRedirectPath("/a\u0000")).toBeNull();
    expect(normalizeRedirectPath(`/${"a".repeat(1200)}`)).toBeNull();
  });

  it("is idempotent", () => {
    for (const s of ["/A/B/?z=1&Y=2", "https://x.nl/Shop.php?code=9", "/tag/World%20War", "x"]) {
      const once = normalizeRedirectPath(s)!;
      expect(normalizeRedirectPath(once)).toBe(once);
    }
  });

  it("redirectPathOnly drops the query", () => {
    expect(redirectPathOnly("/shop.php?code=1")).toBe("/shop.php");
    expect(redirectPathOnly("/a")).toBe("/a");
  });
});
