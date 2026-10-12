import "server-only";
import { shopCache } from "@/server/storefront/cache";
import { smartSearchEnabled } from "./entitlement";
import { similarProducts } from "./service";

/**
 * "Looks like this" for the product page: `similarProducts` through the shop data cache (tagged with
 * the tenant's catalog, so any product change invalidates it; 10 min otherwise). The result is the
 * same for every visitor — callers apply live reservations and country rules on top.
 * Empty without the Smart search module (checked outside the cache, so a package change applies at once).
 */
const cachedSimilar = shopCache("search-similar", "catalog", (tenantId: string, productId: string) => similarProducts(tenantId, productId, { limit: 8 }), 600);

export async function getSimilarProducts(tenantId: string, productId: string): ReturnType<typeof cachedSimilar> {
  if (!(await smartSearchEnabled(tenantId))) return [];
  return cachedSimilar(tenantId, productId);
}
