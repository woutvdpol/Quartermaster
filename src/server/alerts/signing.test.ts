import { beforeAll, describe, expect, it } from "vitest";
import { searchLinkQuery, signAlertLink, verifyAlertLink, verifyWishlistLink, wishlistLinkQuery } from "./signing";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
});

describe("alert link signing", () => {
  it("verifies its own links and rejects tampering / other purposes", () => {
    const q = searchLinkQuery("unsubscribe", "t1", "s1");
    expect(verifyAlertLink("unsubscribe", "t1", "s1", q.sig)).toBe(true);
    expect(verifyAlertLink("manage", "t1", "s1", q.sig)).toBe(false);
    expect(verifyAlertLink("unsubscribe", "t2", "s1", q.sig)).toBe(false);
    expect(verifyAlertLink("unsubscribe", "t1", "s2", q.sig)).toBe(false);
    expect(verifyAlertLink("unsubscribe", "t1", "s1", "x".repeat(80))).toBe(false);
    expect(signAlertLink("manage", "t1", "s1")).not.toBe(q.sig);
  });

  it("wishlist links bind customer and product", () => {
    const w = wishlistLinkQuery("t1", "c1", "p1");
    expect(verifyWishlistLink("t1", "c1", "p1", w.sig)).toBe(true);
    expect(verifyWishlistLink("t1", "c1", "p2", w.sig)).toBe(false);
    expect(verifyWishlistLink("t1", "c2", "p1", w.sig)).toBe(false);
  });
});
