import "server-only";
import { hasModule, tenantsWithModule } from "@/server/modules";
import { getEmbedder, type Embedder } from "./embedder";

/*
 * The "Smart search" module (docs/modules.md): semantic + photo search, "similar items" and the
 * duplicate photo check. Without it a shop searches exactly as when the embedder is down — lexical
 * (full-text + trigram) + facets — so storefront search never fails because of the package.
 * Facet parsing, full-text and trigram search are core and never gated.
 */

export const SMART_SEARCH = "smartSearch" as const;

export function smartSearchEnabled(tenantId: string): Promise<boolean> {
  return hasModule(tenantId, SMART_SEARCH);
}

/** The embedder for one shop's searches: null without the module (→ the lexical fallback path). */
export async function embedderForTenant(tenantId: string): Promise<Embedder | null> {
  return (await smartSearchEnabled(tenantId)) ? getEmbedder() : null;
}

/** The subset of `tenantIds` that has the module (vector retrieval across shops: the network). */
export async function tenantsWithSmartSearch(tenantIds: readonly string[]): Promise<string[]> {
  if (!tenantIds.length) return [];
  const entitled = await tenantsWithModule(SMART_SEARCH);
  return tenantIds.filter((id) => entitled.has(id));
}
