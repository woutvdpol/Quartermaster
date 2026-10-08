import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { SHOP_PRIVATE_PATHS } from "./robots";

/*
 * Every per-visitor / private storefront page must render `noindex` (robots.txt alone does not keep a
 * linked URL out of the index). Static check over the route files, so new private pages can't slip in.
 */
const SHOP_APP = join(process.cwd(), "src", "app", "(shop)");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pages(full);
    return name === "page.tsx" ? [full] : [];
  });
}

/** "/account/addresses/[id]" for ".../(shop)/account/addresses/[id]/page.tsx" (route groups dropped). */
function routeOf(file: string): string {
  const parts = relative(SHOP_APP, file).split(sep).slice(0, -1).filter((p) => !/^\(.*\)$/.test(p));
  return `/${parts.join("/")}`;
}

/** Pages that are private but only redirect (no HTML of their own). */
const REDIRECT_ONLY = new Set(["/account/wishlist"]);

const PRIVATE_PREFIXES = ["/cart", "/checkout", "/account", "/wishlist", "/order", "/offer", "/alerts", "/login", "/register", "/forgot-password", "/newsletter", "/verify", "/qm-unmatched", "/apply/thanks", "/apply/verify"];

describe("private storefront routes", () => {
  const all = pages(SHOP_APP).map((f) => ({ file: f, route: routeOf(f) }));
  const priv = all.filter((p) => PRIVATE_PREFIXES.some((x) => p.route === x || p.route.startsWith(`${x}/`)) && !REDIRECT_ONLY.has(p.route));

  it("finds the private pages", () => {
    expect(priv.length).toBeGreaterThan(20);
  });

  it.each(priv.map((p) => [p.route, p.file]))("%s renders noindex", (_route, file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toMatch(/robots:\s*\{\s*index:\s*false/);
  });

  it("robots.txt disallows the per-visitor areas", () => {
    for (const p of ["/cart", "/checkout", "/account", "/wishlist", "/order/", "/offer/"]) expect(SHOP_PRIVATE_PATHS).toContain(p);
  });
});
