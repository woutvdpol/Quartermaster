import { describe, expect, it } from "vitest";
import { builtinLegacyTarget, isReservedPath, isSafeRelativeTarget, resolveStoredRedirect, toSafeTarget, validateRedirectLink, type StoredRedirect } from "./rules";

function table(rows: [string, string, number?][]) {
  const map = new Map<string, StoredRedirect>(rows.map(([from, to, status], i) => [from, { id: `r${i}`, fromPath: from, toPath: to, statusCode: status ?? 301 }]));
  const calls: string[] = [];
  const lookup = async (k: string) => {
    calls.push(k);
    return map.get(k) ?? null;
  };
  return { lookup, calls };
}

describe("target safety", () => {
  it("accepts only same-origin relative paths", () => {
    expect(isSafeRelativeTarget("/shop")).toBe(true);
    expect(isSafeRelativeTarget("/shop?tag=x#y")).toBe(true);
    for (const bad of ["", "shop", "//evil.com", "/\\evil.com", "\\\\evil", "https://evil.com", "/%2F%2Fevil.com", "/%5cevil", "/a b", "/a\nb", `/${"x".repeat(2001)}`]) {
      expect(isSafeRelativeTarget(bad), bad).toBe(false);
    }
  });

  it("converts same-shop URLs and refuses other hosts", () => {
    const hosts = ["concept500.nl", "www.concept500.nl", "concept.localhost:3000"];
    expect(toSafeTarget("/shop", hosts)).toBe("/shop");
    expect(toSafeTarget("shop/category/x", hosts)).toBe("/shop/category/x");
    expect(toSafeTarget("https://WWW.concept500.nl/product/1/a?x=1", hosts)).toBe("/product/1/a?x=1");
    expect(toSafeTarget("http://concept.localhost:3000/cart", hosts)).toBe("/cart");
    expect(toSafeTarget("https://evil.com/shop", hosts)).toBeNull();
    expect(toSafeTarget("https://concept500.nl.evil.com/", hosts)).toBeNull();
    expect(toSafeTarget("https://user:pw@concept500.nl/", hosts)).toBeNull();
    expect(toSafeTarget("//evil.com/x", hosts)).toBeNull();
    expect(toSafeTarget("javascript:alert(1)", hosts)).toBeNull();
    expect(toSafeTarget("/\\evil.com", hosts)).toBeNull();
  });

  it("knows reserved paths", () => {
    expect(isReservedPath("/admin")).toBe(true);
    expect(isReservedPath("/admin/orders?x=1")).toBe(true);
    expect(isReservedPath("/api/health")).toBe(true);
    expect(isReservedPath("/administration")).toBe(false);
    expect(isReservedPath("/shop")).toBe(false);
  });
});

describe("resolveStoredRedirect", () => {
  it("resolves exact keys, then the path without query", async () => {
    const { lookup } = table([["/old", "/new"], ["/shop.php?code=1", "/product/1"]]);
    expect(await resolveStoredRedirect("/old", lookup)).toEqual({ target: "/new", statusCode: 301, ids: ["r0"] });
    expect(await resolveStoredRedirect("/old?page=2", lookup)).toMatchObject({ target: "/new" });
    expect(await resolveStoredRedirect("/shop.php?code=1", lookup)).toMatchObject({ target: "/product/1" });
    expect(await resolveStoredRedirect("/shop.php?code=2", lookup)).toBeNull();
    expect(await resolveStoredRedirect("/nothing", lookup)).toBeNull();
  });

  it("follows exactly one hop (chains are left to the client) and keeps the row's status", async () => {
    const { lookup } = table([["/a", "/b"], ["/b", "/c", 302]]);
    expect(await resolveStoredRedirect("/a", lookup)).toEqual({ target: "/b", statusCode: 301, ids: ["r0"] });
    expect(await resolveStoredRedirect("/b", lookup)).toEqual({ target: "/c", statusCode: 302, ids: ["r1"] });
  });

  it("never redirects to itself or around a loop", async () => {
    expect(await resolveStoredRedirect("/a", table([["/a", "/A/"]]).lookup)).toBeNull();
    expect(await resolveStoredRedirect("/a", table([["/a", "/a?x=1"]]).lookup)).toBeNull();
    expect(await resolveStoredRedirect("/a", table([["/a", "/b"], ["/b", "/a"]]).lookup)).toBeNull();
    // B's own row only matters when it points straight back to A.
    expect(await resolveStoredRedirect("/a", table([["/a", "/b"], ["/b", "/b?x=1"]]).lookup)).toMatchObject({ target: "/b" });
    // A path row catches all its query variants: /a?x → /a?y would hit /a again.
    expect(await resolveStoredRedirect("/a?x=1", table([["/a", "/a?y=2"]]).lookup)).toBeNull();
  });

  it("drops unsafe stored targets (e.g. ETL rows)", async () => {
    expect(await resolveStoredRedirect("/a", table([["/a", "https://evil.com"]]).lookup)).toBeNull();
    expect(await resolveStoredRedirect("/a", table([["/a", "//evil.com"]]).lookup)).toBeNull();
  });

  it("does at most two lookups per key variant (own row + loop check)", async () => {
    const t = table([["/a", "/b"], ["/b", "/c"], ["/c", "/d"]]);
    await resolveStoredRedirect("/a", t.lookup);
    expect(t.calls).toEqual(["/a", "/b"]);
  });
});

describe("validateRedirectLink", () => {
  it("refuses self-redirects and loops, allows chains", async () => {
    const { lookup } = table([["/b", "/c"], ["/c", "/a"], ["/x", "/y"]]);
    expect(await validateRedirectLink("/a", "/A/", lookup)).toMatch(/itself/);
    expect(await validateRedirectLink("/a", "/a?x=1", lookup)).toMatch(/itself/);
    expect(await validateRedirectLink("/a?x=1", "/a", lookup)).toBeNull();
    expect(await validateRedirectLink("/a", "/b", lookup)).toMatch(/loop/);
    expect(await validateRedirectLink("/w", "/x", lookup)).toBeNull();
    expect(await validateRedirectLink("/new", "/fresh", lookup)).toBeNull();
  });

  it("refuses very long chains", async () => {
    const rows: [string, string][] = Array.from({ length: 15 }, (_, i) => [`/p${i}`, `/p${i + 1}`]);
    expect(await validateRedirectLink("/start", "/p0", table(rows).lookup)).toMatch(/too long/);
  });
});

describe("builtinLegacyTarget", () => {
  it("maps Concept500 patterns", () => {
    expect(builtinLegacyTarget("/shop.php?code=50231")).toEqual({ kind: "product", stockCode: 50231 });
    expect(builtinLegacyTarget("/shop.php?code=abc")).toBeNull();
    expect(builtinLegacyTarget("/shop.php")).toBeNull();
    expect(builtinLegacyTarget("/basket")).toEqual({ kind: "path", target: "/cart" });
    expect(builtinLegacyTarget("/profile/orders")).toEqual({ kind: "path", target: "/account/orders" });
    expect(builtinLegacyTarget("/profile/order/12")).toEqual({ kind: "path", target: "/account/orders" });
    expect(builtinLegacyTarget("/shop/tag/world war ii")).toEqual({ kind: "tag", name: "world war ii" });
    expect(builtinLegacyTarget("/shop/tag/a/b")).toBeNull();
    expect(builtinLegacyTarget("/something-else")).toBeNull();
  });
});
