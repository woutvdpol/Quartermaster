import "server-only";
import { revalidateTag } from "next/cache";
import { shopTag } from "@/server/storefront/cache";

/*
 * Cache tags for public catalog reads. Every cached storefront-catalog query is tagged with
 * `tenant:{id}:catalog`, so one call invalidates a whole shop's catalog (lists, facets, product pages,
 * category tree, archive).
 */

/** `tenant:{id}:catalog` — shared with the foundation's shopCache(…, "catalog") reads (home blocks). */
export const catalogTag = (tenantId: string) => shopTag(tenantId, "catalog");

/**
 * Invalidate every cached catalog read of a tenant. Call after any mutation that changes what the shop
 * shows: product create/update/status/delete/bump, images, tags, categories, relations, stock movements
 * that flip a status, order finalization (→ SOLD), and catalog settings changes.
 *
 * `{ expire: 0 }`: unique items — a SOLD item must not be served stale as "for sale".
 * Safe to call from Server Actions and Route Handlers (e.g. the Mollie webhook); a no-op outside Next.
 */
export function revalidateCatalog(tenantId: string): void {
  try {
    revalidateTag(catalogTag(tenantId), { expire: 0 });
  } catch (error) {
    // Outside a Next request scope (scripts, workers, tests) there is no cache to invalidate.
    if (process.env.NODE_ENV !== "test") console.warn("[storefront-catalog] revalidateCatalog skipped:", (error as Error).message);
  }
}
