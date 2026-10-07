import { describe, expect, it } from "vitest";
import { isExternalUrl, sanitizeUrl } from "./url";

describe("sanitizeUrl", () => {
  it.each([
    "https://example.com",
    "http://example.com/path?q=1#x",
    "mailto:info@example.com",
    "mailto:info@example.com?subject=Hi",
    "/shop",
    "/shop/category/helmets?sort=new",
    "#top",
    "?page=2",
    "about",
    "pages/about",
    "/a:b",
  ])("allows %s", (url) => expect(sanitizeUrl(url)).toBe(url));

  it("trims surrounding whitespace", () => expect(sanitizeUrl("  /shop  ")).toBe("/shop"));

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0000javascript:alert(1)",
    "jav​ascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com",
    "//evil.com",
    "/\\evil.com",
    "https:\\\\evil.com",
    "https://user:pass@evil.com",
    "https://shop.com@evil.com",
    "mailto:",
    "1javascript:alert(1)",
    "http://",
    "",
    "has space",
    "x".repeat(3000),
  ])("rejects %j", (url) => expect(sanitizeUrl(url)).toBeNull());

  it("rejects non-strings", () => {
    expect(sanitizeUrl(null)).toBeNull();
    expect(sanitizeUrl(42)).toBeNull();
  });

  it("flags only absolute http(s) as external", () => {
    expect(isExternalUrl("https://x.com")).toBe(true);
    expect(isExternalUrl("/shop")).toBe(false);
    expect(isExternalUrl("mailto:a@b.c")).toBe(false);
  });
});
