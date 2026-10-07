import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";

/*
 * Storefront caching (decision: `cacheComponents` stays OFF — it would force every request-time read in the admin behind Suspense; see next.config.ts).
 *
 * Shop reads that are identical for every visitor (settings, menus, CMS pages, product lists) go
 * through `shopCache`, a thin wrapper over `unstable_cache` keyed by tenantId + arguments and tagged
 * per tenant and area. Entries expire after SHOP_CACHE_SECONDS; admin mutations can (and should)
 * call `revalidateTag(shopTag(tenantId, area), "max")` to make changes visible immediately.
 *
 * Per-visitor data (session, cart, reservations, wishlist) is never cached here.
 * Values are JSON-serialised by the cache: return plain data (Dates become ISO strings — use string
 * fields in cached return types).
 */

export const SHOP_CACHE_SECONDS = 60;

export type ShopCacheArea = "settings" | "content" | "catalog";

/** Tag for one area of one tenant, e.g. `tenant:abc:content`. */
export function shopTag(tenantId: string, area: ShopCacheArea): string {
  return `tenant:${tenantId}:${area}`;
}

/** Tag covering everything of one tenant. */
export function tenantTag(tenantId: string): string {
  return `tenant:${tenantId}`;
}

/**
 * Wraps `fn(tenantId, ...args)` in the data cache. `name` must be unique per function.
 * Arguments must be JSON-serialisable (they form the cache key).
 */
export function shopCache<A extends unknown[], R>(
  name: string,
  area: ShopCacheArea,
  fn: (tenantId: string, ...args: A) => Promise<R>,
  revalidate: number = SHOP_CACHE_SECONDS,
): (tenantId: string, ...args: A) => Promise<R> {
  return (tenantId: string, ...args: A) =>
    unstable_cache(() => fn(tenantId, ...args), ["storefront", name, tenantId, JSON.stringify(args)], {
      tags: [tenantTag(tenantId), shopTag(tenantId, area)],
      revalidate,
    })();
}

/**
 * Makes an admin change visible in the shop immediately. Called from `audit()`, which every
 * mutation runs after its transaction commits, so no service needs its own cache calls.
 * `expire: 0` — items are unique; a sold product must never be served stale as "for sale".
 * Outside a Next request (seed, worker, tests) there is no cache and this is a no-op.
 */
export function invalidateShopForAction(tenantId: string | null | undefined, action: string): void {
  if (!tenantId) return;
  const tags = shopTagsForAction(tenantId, action);
  for (const tag of tags) {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch {
      return; // not in a request scope
    }
  }
}

/** Which cached shop areas an audited action can change. Exported for tests. */
export function shopTagsForAction(tenantId: string, action: string): string[] {
  const area = action.split(".")[0];
  switch (area) {
    case "product":
    case "category":
    case "tag":
    case "stock":
    case "reservation":
      return [shopTag(tenantId, "catalog")];
    case "order":
      // Paying/cancelling changes product availability (SOLD / released).
      return action === "order.mark_paid" || action === "order.cancel" ? [shopTag(tenantId, "catalog")] : [];
    case "content":
      return [shopTag(tenantId, "content")];
    case "settings":
    case "shipping":
    case "payments":
    case "tenant":
    case "domain":
      return [tenantTag(tenantId)];
    default:
      return [];
  }
}
