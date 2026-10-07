import { describe, expect, it } from "vitest";
import { loginHref, safeShopRedirect } from "./redirect";

describe("safeShopRedirect", () => {
  it("accepts storefront paths", () => {
    expect(safeShopRedirect("/wishlist")).toBe("/wishlist");
    expect(safeShopRedirect("/product/123/helmet?x=1#a")).toBe("/product/123/helmet?x=1#a");
    expect(safeShopRedirect("/account/orders")).toBe("/account/orders");
  });

  it("rejects open redirects, admin/api targets and auth pages", () => {
    for (const bad of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "evil",
      "/admin",
      "/admin/dashboard",
      "/API/x",
      "/login",
      "/register?next=/x",
      "/account/reset-password?token=x",
      "/a b",
      "/x\ny",
      undefined,
      ["/x"],
    ]) {
      expect(safeShopRedirect(bad)).toBe("/account");
    }
    expect(safeShopRedirect("/admin", "/")).toBe("/");
  });

  it("builds login links", () => {
    expect(loginHref("/product/1/x")).toBe("/login?next=%2Fproduct%2F1%2Fx");
    expect(loginHref("//evil")).toBe("/login");
    expect(loginHref(null)).toBe("/login");
  });
});
