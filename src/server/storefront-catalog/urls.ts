/** Public catalog URLs (pure; single place to change when routes move — decision 22: URLs may change). */

export const SHOP_PATH = "/shop";
export const ARCHIVE_PATH = "/archive";

export const productHref = (p: { stockCode: number; slug: string }) => `/product/${p.stockCode}/${encodeURIComponent(p.slug)}`;
export const categoryHref = (slug: string) => `/shop/category/${encodeURIComponent(slug)}`;
/** Sold archive filtered to one category (and its subcategories). */
export const archiveCategoryHref = (slug: string) => `${ARCHIVE_PATH}/category/${encodeURIComponent(slug)}`;
export const tagHref = (slug: string) => `/shop?tag=${encodeURIComponent(slug)}`;
/** SEO landing page for one facet value (/shop/facet/{facet}/{value}). */
export const facetValueHref = (facetSlug: string, valueSlug: string) => `/shop/facet/${encodeURIComponent(facetSlug)}/${encodeURIComponent(valueSlug)}`;
/** Shop list filtered by facet values (query form, combinable). */
export const facetFilterHref = (tokens: string[]) => (tokens.length ? `/shop?${tokens.map((t) => `f=${encodeURIComponent(t)}`).join("&")}` : "/shop");

/** Parses the `[stockCode]` route segment; null when it is not a plausible stock code. */
export function parseStockCode(raw: string): number | null {
  const s = decodeURIComponent(raw).replace(/^#/, "");
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}
