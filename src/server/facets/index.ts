import "server-only";

/*
 * Facet taxonomy (phase 5). Admin services take a ServiceContext first; `seedDefaultFacets(tenantId)`
 * is a system operation. Pure tree helpers live in ./tree (client-safe), standard facets in ./defaults.
 * Shop-side reads (filters, counts) live in src/server/storefront-catalog.
 */
export * from "./service";
export * from "./tree";
export { DEFAULT_FACETS, type DefaultFacet, type DefaultValue } from "./defaults";
