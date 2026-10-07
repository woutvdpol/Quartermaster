import { normalizeRedirectPath, redirectPathOnly } from "../../../src/server/redirects/normalize";
import { categoryHref, facetValueHref, productHref, tagHref } from "../../../src/server/storefront-catalog/urls";

/**
 * Legacy Concept500 public URLs (routes/web.php) → Quartermaster URLs.
 *
 * Legacy route                         | New
 * -------------------------------------|---------------------------------------------------------
 * /product/{id}/{slug}                 | /product/{stockCode}/{slug} (the app also 308s wrong slugs)
 * /product/{id}, /product/{id}/image/… | handled by the app's catch-all product route (→ canonical)
 * /shop.php?code={id}                  | /product/{id}/{slug} (query-based → needs a redirect row)
 * /shop/category/{slug}                | /shop/category/{newSlug}
 * /shop/tag/{name}  (tag NAME, not slug)| /shop/facet/{facet}/{value} when converted, else /shop?tag={slug}
 * /pages/{url}                         | /{pageSlug} (block CMS; HOME → /)
 * /{terms|privacy|about|contact|news|events|links} | /{pageSlug}
 * /basket, /profile/…, /checkout/guest, /home | /cart, /account/…, /checkout, /
 *
 * Redirect rows are only produced when the normalised old path differs from the new one.
 */

export type UrlMaps = {
  /** stockCode → new slug */
  products: Map<number, string>;
  /** stockCode → legacy slug (raw) */
  legacyProductSlugs: Map<number, string>;
  /** legacy category slug (raw) → new slug */
  categories: Map<string, string>;
  /** legacy tag name (raw) → new target href */
  tags: Map<string, string>;
  /** legacy content_pages.url (raw, e.g. "testpage") → new href */
  cmsPages: Map<string, string>;
  /** legacy ShopPageEnum path (e.g. "terms") → new href */
  contentPages: Map<string, string>;
};

export const STATIC_LEGACY_ROUTES: Record<string, string> = {
  "/home": "/",
  "/pages/home": "/",
  "/basket": "/cart",
  "/checkout/guest": "/checkout",
  "/profile": "/account/profile",
  "/profile/dashboard": "/account",
  "/profile/addresses": "/account/addresses",
  "/profile/address/add": "/account/addresses/new",
  "/profile/orders": "/account/orders",
  "/profile/wishlist": "/account/wishlist",
  "/shop.php": "/shop",
};

/** Legacy routes that exist unchanged in the new shop. */
const SAME_ROUTES = new Set(["/shop", "/archive", "/checkout", "/login", "/register", "/forgot-password"]);

export function emptyUrlMaps(): UrlMaps {
  return { products: new Map(), legacyProductSlugs: new Map(), categories: new Map(), tags: new Map(), cmsPages: new Map(), contentPages: new Map() };
}

export const newProductHref = (stockCode: number, slug: string) => productHref({ stockCode, slug });
export const newCategoryHref = (slug: string) => categoryHref(slug);
export const newTagHref = (slug: string, facet?: { facetSlug: string; valueSlug: string } | null) =>
  facet ? facetValueHref(facet.facetSlug, facet.valueSlug) : tagHref(slug);

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Maps one legacy path (+ optional query) to its new URL, or null when it is unknown / not a page.
 * Used for links inside migrated content and menus. Input may be any case; output is a new-app path.
 */
export function mapLegacyPath(pathWithQuery: string, maps: UrlMaps): string | null {
  const q = pathWithQuery.indexOf("?");
  const rawPath = (q >= 0 ? pathWithQuery.slice(0, q) : pathWithQuery).replace(/\/+$/, "") || "/";
  const query = new URLSearchParams(q >= 0 ? pathWithQuery.slice(q + 1) : "");
  const lower = rawPath.toLowerCase();
  if (lower === "/") return "/";

  if (lower === "/shop.php") {
    const code = Number(query.get("code"));
    const slug = Number.isInteger(code) ? maps.products.get(code) : undefined;
    return slug ? newProductHref(code, slug) : "/shop";
  }
  if (Object.hasOwn(STATIC_LEGACY_ROUTES, lower)) return STATIC_LEGACY_ROUTES[lower];
  if (SAME_ROUTES.has(lower)) return lower;

  const segments = rawPath.split("/").filter(Boolean).map(safeDecode);
  const [first, second, third] = segments;
  switch (first?.toLowerCase()) {
    case "product": {
      const code = Number(second);
      if (!Number.isInteger(code)) return null;
      const slug = maps.products.get(code);
      return slug ? newProductHref(code, slug) : null;
    }
    case "shop": {
      if (second?.toLowerCase() === "category" && third) {
        const slug = findCaseInsensitive(maps.categories, third);
        return slug ? newCategoryHref(slug) : "/shop";
      }
      if (second?.toLowerCase() === "tag" && third) return findCaseInsensitive(maps.tags, third) ?? "/shop";
      return null;
    }
    case "pages": {
      const url = segments.slice(1).join("/");
      return findCaseInsensitive(maps.cmsPages, url) ?? null;
    }
    case "order":
      return segments.length === 2 ? `/order/${second.toLowerCase()}` : null;
    default:
      if (segments.length === 1) return findCaseInsensitive(maps.contentPages, segments[0]) ?? null;
      return null;
  }
}

function findCaseInsensitive(map: Map<string, string>, key: string): string | undefined {
  if (map.has(key)) return map.get(key);
  const lower = key.toLowerCase();
  for (const [k, v] of map) if (k.toLowerCase() === lower) return v;
  return undefined;
}

/**
 * Turns a URL found in legacy content/menus into a link for the new shop:
 *  - relative or same-shop absolute URLs (host in `legacyHosts`, or — when none are configured — any
 *    absolute URL whose path is a known legacy route) → mapped new path (unknown paths kept as path);
 *  - other absolute URLs (external sites) and mailto: → unchanged.
 * Returns null for empty/unsafe input.
 */
export function relativizeLegacyUrl(url: string | null | undefined, maps: UrlMaps, legacyHosts: readonly string[] = []): string | null {
  const s = (url ?? "").trim();
  if (!s) return null;
  if (/^mailto:/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:/i.test(s)) return null;
  let pathQuery = s;
  if (/^https?:/i.test(s)) {
    let parsed: URL;
    try {
      parsed = new URL(s);
    } catch {
      return null;
    }
    const host = parsed.host.toLowerCase();
    const sameShop = legacyHosts.length
      ? legacyHosts.some((h) => h.toLowerCase() === host || h.toLowerCase() === parsed.hostname.toLowerCase())
      : mapLegacyPath(parsed.pathname + parsed.search, maps) !== null;
    if (!sameShop) return s;
    pathQuery = parsed.pathname + parsed.search;
  } else if (s.startsWith("//")) {
    return null;
  } else if (!s.startsWith("/") && !s.startsWith("?") && !s.startsWith("#")) {
    pathQuery = `/${s}`;
  }
  if (pathQuery.startsWith("#") || pathQuery.startsWith("?")) return pathQuery;
  return mapLegacyPath(pathQuery, maps) ?? (pathQuery.split("?")[0] || "/");
}

export type RedirectRow = { fromPath: string; toPath: string; kind: string };

/**
 * Old paths the redirect runtime (src/server/redirects/rules.ts builtinLegacyTarget) already resolves
 * without a table row: /shop.php?code=N, /basket, /profile*, /checkout/guest, /shop/tag/{name}; and
 * /product/{id}[/{slug}] matches the new product route (wrong slugs → 308 to canonical).
 */
export function isHandledByRuntime(fromPath: string): boolean {
  const path = fromPath.split("?")[0];
  if (path === "/shop.php" && fromPath.includes("code=")) return true;
  if (path === "/basket" || path === "/checkout/guest" || path === "/profile" || path.startsWith("/profile/")) return true;
  if (/^\/shop\/tag\/[^/]+$/.test(path)) return true;
  if (/^\/product\/[^/]+(\/[^/]+)?$/.test(path)) return true;
  return false;
}

/**
 * Legacy redirect rows derivable from the imported data, for paths the runtime does NOT handle
 * itself (see isHandledByRuntime): renamed category slugs, CMS pages (/pages/{url} → /{slug}),
 * legacy content pages (/terms, /news, … when the slug changed) and a few static routes.
 * `fromPath` = normalizeRedirectPath (shared with the runtime lookup); `toPath` is always a relative
 * path. Unusable input is returned in `rejected` (counted in the report). Identity rows are skipped.
 */
export function buildLegacyRedirects(maps: UrlMaps): { rows: RedirectRow[]; rejected: string[]; handledByRuntime: number } {
  const rows = new Map<string, RedirectRow>();
  const rejected: string[] = [];
  let handledByRuntime = 0;
  const add = (from: string, to: string, kind: string) => {
    const fromPath = normalizeRedirectPath(from, { keepQuery: false });
    if (!fromPath || !to.startsWith("/") || to.startsWith("//")) {
      rejected.push(`${kind}: ${from.slice(0, 80)}`);
      return;
    }
    if (isHandledByRuntime(fromPath)) {
      handledByRuntime++;
      return;
    }
    if (normalizeRedirectPath(to) === fromPath) return;
    if (redirectPathOnly(fromPath) === "/") return;
    if (!rows.has(fromPath)) rows.set(fromPath, { fromPath, toPath: to, kind });
  };

  for (const from of ["/home", "/pages/home", "/shop.php"]) add(from, STATIC_LEGACY_ROUTES[from], "static");
  for (const [legacySlug, slug] of maps.categories) add(`/shop/category/${encodeURIComponent(legacySlug)}`, newCategoryHref(slug), "category");
  for (const [url, href] of maps.cmsPages) add(`/pages/${url}`, href, "cms-page");
  for (const [path, href] of maps.contentPages) add(`/${path}`, href, "content-page");
  // Product and tag URLs are resolved by the runtime; counted for the report only.
  handledByRuntime += maps.products.size + maps.tags.size;
  return { rows: [...rows.values()], rejected, handledByRuntime };
}
