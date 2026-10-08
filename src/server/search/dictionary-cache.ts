import { TtlLru } from "./lru";
import type { ShopDictionary } from "./dictionary";

/** In-process cache of per-tenant parser dictionaries (30 s). Separate module: audit() imports it via ./hooks. */
export const dictionaryCache = new TtlLru<Promise<ShopDictionary>>(200, 30_000);

export function invalidateShopDictionary(tenantId: string): void {
  dictionaryCache.delete(tenantId);
}
