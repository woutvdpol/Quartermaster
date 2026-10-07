import "server-only";
import { selectedValueIds } from "./facet-selection";
import { shopCache } from "@/server/storefront/cache";
import * as q from "./queries";
import type { CatalogParams } from "./params";

/*
 * Cached public catalog reads (foundation's `shopCache` = unstable_cache keyed by tenantId + args,
 * tagged `tenant:{id}` and `tenant:{id}:catalog`, 60 s safety TTL). `cacheComponents` stays off.
 * Results are JSON (DTOs use ISO strings). Per-visitor / time-dependent data (live cart
 * reservations, the session) is NOT cached — combine with `liveReservedIds` per request.
 * Invalidate with `revalidateCatalog(tenantId)` (./cache.ts).
 */

export const getCategoryTree = shopCache(
  "sc-tree",
  "catalog",
  q.getPublicCategoryTree,
);
export const getCategoryBySlug = shopCache(
  "sc-category",
  "catalog",
  q.getPublicCategoryBySlug,
);
export const getCatalogPage = shopCache("sc-list", "catalog", q.listCatalog);
const cachedFacets = shopCache("sc-facets", "catalog", q.getCatalogFacets);
export const getTagsBySlug = shopCache("sc-tags", "catalog", q.getTagsBySlug);
export const getProduct = shopCache(
  "sc-product",
  "catalog",
  q.getPublicProduct,
);
export const getRelated = shopCache(
  "sc-related",
  "catalog",
  q.getRelatedProducts,
);
/** Facets + values of the shop (no counts) — landing pages, chips, legacy tag redirects. */
export const getTaxonomy = shopCache(
  "sc-taxonomy",
  "catalog",
  q.getPublicTaxonomy,
);

/** Facets do not depend on sort/paging/view: normalised so one cache entry serves them all. */
export function getFacets(
  tenantId: string,
  scope: q.ListScope,
  params: CatalogParams,
) {
  return cachedFacets(tenantId, scope, {
    ...params,
    facets: [...params.facets].sort(),
    facetValueIds: [...params.facetValueIds].sort(),
    sort: "newest",
    page: 1,
    show: null,
    view: null,
  });
}

export {
  liveReservedIds,
  ownReservedIds,
  withLiveStatus,
  flattenTree,
  subtreeIds,
  categoryPath,
  type CatalogMode,
  type ListScope,
} from "./queries";
export { revalidateCatalog, catalogTag } from "./cache";
export * from "./params";
export * from "./urls";
export * from "./country";
export {
  resolveFacetSelection,
  selectedValueIds,
  tokensForValueIds,
  type FacetSelection,
} from "./facet-selection";

/**
 * Ids of the facet values selected in the URL (both `f=<facet>.<value>` tokens and `f=<id>`), not
 * expanded to descendants — e.g. for saving a search ({ facetValueIds }). Landing pages: pass their
 * locked token(s) in `extraTokens`.
 */
export async function selectedFacetValueIds(
  tenantId: string,
  params: CatalogParams,
  extraTokens: string[] = [],
): Promise<string[]> {
  if (
    !params.facets.length &&
    !params.facetValueIds.length &&
    !extraTokens.length
  )
    return [];
  const tax = await getTaxonomy(tenantId);
  return selectedValueIds(
    tax,
    [...extraTokens, ...params.facets],
    params.facetValueIds,
  );
}
export type * from "./types";
