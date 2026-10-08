import type { Metadata } from "next";
import { hasActiveFilters, type CatalogParams, type CatalogSort } from "@/server/storefront-catalog/params";
import { SHOP_PATH, facetValueHref } from "@/server/storefront-catalog/urls";
import { shopOgDefaults, type OgShop } from "@/lib/seo/metadata";
import { metaDescription, metaTitle } from "@/lib/seo/text";

/**
 * Metadata for catalog listings (docs/seo-geo.md §Canonical & indexering):
 *  - canonical = the clean path; page 2+ is self-canonical (`?page=N`) and indexable — Google no
 *    longer uses rel=prev/next and asks for self-referencing canonicals on paginated series;
 *  - searched, filtered, re-sorted, "load more" and list-view variants are `noindex, follow`
 *    (their canonical points at the clean listing);
 *  - exactly one facet filter on /shop (`/shop?f=period.ww2`) is the same list as the facet landing
 *    page, so it declares that page canonical instead.
 */
export function catalogMetadata({
  shop,
  path,
  params,
  title,
  description,
  defaultSort,
}: {
  shop: OgShop;
  path: string;
  params: CatalogParams;
  title: string;
  description: string;
  defaultSort: CatalogSort;
}): Metadata {
  const resorted = params.sort !== defaultSort;
  const variant = hasActiveFilters(params) || params.show !== null || params.view !== null || resorted;
  const landing = landingFor(path, params, resorted);
  const canonical = landing ?? (params.page > 1 && !variant ? `${path}?page=${params.page}` : path);
  const fullTitle = metaTitle(params.page > 1 ? `${title} – page ${params.page}` : title);
  const desc = metaDescription(description);
  return {
    title: fullTitle,
    description: desc,
    alternates: { canonical },
    // Only set when needed: `robots: undefined` would also wipe the layout's noindex (coming soon / preview).
    ...(variant && !landing ? { robots: { index: false, follow: true } } : {}),
    openGraph: { ...shopOgDefaults(shop), title: fullTitle, description: desc, url: canonical },
  };
}

/** The facet landing page equal to this view, if any (one facet token on /shop, nothing else). */
function landingFor(path: string, p: CatalogParams, resorted: boolean): string | null {
  if (path !== SHOP_PATH || resorted || p.page > 1 || p.show !== null || p.view !== null) return null;
  if (p.q || p.tags.length || p.facetValueIds.length || p.min !== null || p.max !== null || p.facets.length !== 1) return null;
  const [facetSlug, valueSlug, extra] = p.facets[0].split(".");
  return facetSlug && valueSlug && extra === undefined ? facetValueHref(facetSlug, valueSlug) : null;
}
