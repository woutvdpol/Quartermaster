import "server-only";
import { getSettings } from "@/server/settings";
import { getPublicTaxonomy } from "@/server/storefront-catalog/queries";
import type { PublicTaxonomy } from "@/server/storefront-catalog/types";
import { dictionaryCache as cache } from "./dictionary-cache";
import { buildDictionary, buildExpansions, parseQuery, type ParsedQuery, type ParserInput } from "./parser";
import { parseSynonyms } from "./synonyms";

/*
 * Per-tenant parser state (taxonomy + synonyms → phrase dictionary), cached in-process for 30 s and
 * dropped immediately on facet/settings changes in this process (./hooks.ts). Building it costs a
 * couple of ms; parsing a query with it ~0.1 ms.
 */

export type ShopDictionary = {
  taxonomy: PublicTaxonomy;
  input: ParserInput;
  prepared: { dict: ReturnType<typeof buildDictionary>; expansions: ReturnType<typeof buildExpansions> };
};

/** `currency` = the tenant's shop currency (price chip labels); one per tenant, so not part of the key. */
export function getShopDictionary(tenantId: string, currency: string): Promise<ShopDictionary> {
  const key = tenantId;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const [taxonomy, catalog] = await Promise.all([getPublicTaxonomy(tenantId), getSettings(tenantId, "catalog")]);
    const input: ParserInput = { taxonomy, synonyms: parseSynonyms(catalog.searchSynonyms), currency };
    return { taxonomy, input, prepared: { dict: buildDictionary(input), expansions: buildExpansions(input) } };
  })();
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  return p;
}

export { invalidateShopDictionary } from "./dictionary-cache";

export function parseWith(dict: ShopDictionary, q: string): ParsedQuery {
  return parseQuery(q, dict.input, dict.prepared);
}
