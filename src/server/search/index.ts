import "server-only";

/*
 * Smart search (docs/search.md). Public server API for pages, route handlers and the search UI:
 *
 *   searchProducts(tenantId, input)        → SearchResult (items, total, interpretation chips, facets, timing)
 *   suggest(tenantId, q, opts)             → Suggestions (facet values + up to 5 products)
 *   searchByImage(tenantId, rgb, input)    → SearchResult (decode uploads with decodeSearchImage first)
 *   similarProducts(tenantId, productId)   → CatalogCard[] (getSimilarProducts: data-cached per tenant)
 *   searchHints(tenantId, q)               → "did you mean" for searches without results
 *
 * Route handlers: GET /api/search/suggest?q=…, POST /api/search/image (multipart `file`, optional `q`).
 * Admin: getSearchIndexOverview / requestReindex. Indexing runs in the worker (./jobs.ts).
 */
export {
  searchProducts,
  suggest,
  searchByImage,
  similarProducts,
  warmSearchModels,
  SearchUnavailableError,
  MAX_RESULTS,
  type SearchInput,
  type SearchFilters,
  type SearchResult,
  type SearchInterpretation,
  type SearchTiming,
  type RetrieverState,
  type Suggestions,
  type FacetSuggestion,
  type ImageSearchInput,
  type NearMisses,
  type SuggestReason,
} from "./service";
export { searchHints, type SearchHints } from "./hints";
export { getSimilarProducts } from "./similar";
export type { InterpretationChip, ChipKind } from "./parser";
export { decodeSearchImage, SearchImageError, SEARCH_IMAGE_MAX_BYTES } from "./image-input";
export { getSearchIndexOverview, requestReindex, type SearchIndexOverview, type SearchIndexRunDto } from "./admin";
export { searchRequestContext, toPublicCards, type SearchRequestContext } from "./request";
