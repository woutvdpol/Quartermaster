import "server-only";
import { enqueue } from "@/server/jobs/queue";
import { invalidateShopDictionary } from "./dictionary-cache";

/*
 * Keeps the search index current. Called from `audit()` (src/server/audit.ts), which every admin
 * mutation runs after its transaction commits — so no service needs its own search calls:
 *
 *   entity "Product" + a product id  → search.embed-product (debounced per product, 5 s)
 *   taxonomy-wide changes            → search.reindex-tenant (debounced per tenant, 60 s)
 *     (facet/value renames, merges, bulk assign, category renames, finished imports)
 *
 * Only enqueues; failures are logged, never thrown (a search problem must not break a save).
 * The `search.sync` cron catches anything missed.
 */

const TENANT_WIDE = new Set([
  "facet.update",
  "facet.delete",
  "facet.value_update",
  "facet.value_move",
  "facet.value_delete",
  "facet.value_merge",
  "facet.convert_tags",
  "category.update",
  "category.delete",
  "category.move",
  "tag.update",
  "tag.delete",
  "tag.merge",
  "import.done",
  "import.published",
  "import.products_done",
]);

const CUID = /^c[a-z0-9]{20,32}$/;

export function searchHookFor(action: string, entity: string | undefined, entityId: string | number | undefined): "product" | "tenant" | null {
  if (entity === "Product" && typeof entityId === "string" && CUID.test(entityId) && (action.startsWith("product.") || action.startsWith("facet.") || action.startsWith("stock."))) {
    return "product";
  }
  if (TENANT_WIDE.has(action) || (entity === "Product" && entityId === "bulk")) return "tenant";
  return null;
}

/** audit() → search index. Never throws. */
export async function onAudited(entry: { action: string; tenantId?: string | null; entity?: string; entityId?: string | number }): Promise<void> {
  if (!entry.tenantId) return;
  // Facet names and synonyms feed the query parser: rebuild its dictionary (this process; others
  // pick changes up within the 30 s cache TTL).
  if (entry.action.startsWith("facet.") || entry.action === "settings.update") invalidateShopDictionary(entry.tenantId);
  if (process.env.SEARCH_INDEXING === "off") return;
  const kind = searchHookFor(entry.action, entry.entity, entry.entityId);
  if (!kind) return;
  try {
    if (kind === "product") {
      await enqueue("search.embed-product", { tenantId: entry.tenantId, productId: String(entry.entityId) }, { singletonKey: String(entry.entityId), startAfter: 5 });
    } else {
      await enqueue("search.reindex-tenant", { tenantId: entry.tenantId }, { singletonKey: entry.tenantId, startAfter: 60 });
    }
  } catch (err) {
    console.error(`[search] index hook for ${entry.action} failed`, err);
  }
}
