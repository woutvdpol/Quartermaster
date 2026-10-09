import "server-only";

/*
 * Quartermaster network (docs/network.md): one public search over the stock of every shop that opted in.
 *   ./eligibility.ts  who/what may appear (pure)     ./params.ts  page URL params (pure)
 *   ./service.ts      directory + search (cached)    ./admin.ts   opt-in + platform moderation
 * Routing and links: src/lib/network.ts (NETWORK_HOST / PLATFORM_HOST/network).
 */
export * from "./service";
export * from "./admin";
export * from "./params";
export { NETWORK_TENANT_WHERE, isNetworkEligibleTenant, isNetworkEligibleProduct, type NetworkFacetOption } from "./eligibility";
