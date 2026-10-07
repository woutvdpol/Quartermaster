import "server-only";
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

export const getCategoryTree = shopCache("sc-tree", "catalog", q.getPublicCategoryTree);
export const getCategoryBySlug = shopCache("sc-category", "catalog", q.getPublicCategoryBySlug);
export const getCatalogPage = shopCache("sc-list", "catalog", q.listCatalog);
const cachedFacets = shopCache("sc-facets", "catalog", q.getCatalogFacets);
export const getTagsBySlug = shopCache("sc-tags", "catalog", q.getTagsBySlug);
export const getProduct = shopCache("sc-product", "catalog", q.getPublicProduct);
export const getRelated = shopCache("sc-related", "catalog", q.getRelatedProducts);

/** Facets do not depend on sort/paging/view: normalised so one cache entry serves them all. */
export function getFacets(tenantId: string, scope: q.ListScope, params: CatalogParams) {
  return cachedFacets(tenantId, scope, { ...params, sort: "newest", page: 1, show: null, view: null });
}

export { liveReservedIds, withLiveStatus, flattenTree, subtreeIds, categoryPath, type CatalogMode, type ListScope } from "./queries";
export { revalidateCatalog, catalogTag } from "./cache";
export * from "./params";
export * from "./urls";
export * from "./tag-groups";
export * from "./country";
export type * from "./types";
