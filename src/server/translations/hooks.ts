import "server-only";
import { enqueue } from "@/server/jobs/queue";
import { getSettings } from "@/server/settings";
import type { TranslationEntityName } from "./fields";

/*
 * Keeps translations current. Called from `audit()` (src/server/audit.ts) after every admin mutation
 * has committed — services need no translation calls of their own. Only enqueues (a debounced
 * `translations.sync` job); never throws, so a translation problem can never break a save.
 * Does nothing for shops without extra languages (settings.i18n.locales = []).
 */

const ENTITY_ACTIONS: Record<string, { model: string; entity: TranslationEntityName }> = {
  "product.create": { model: "Product", entity: "PRODUCT" },
  "product.update": { model: "Product", entity: "PRODUCT" },
  "product.duplicate": { model: "Product", entity: "PRODUCT" },
  "product.bulk_update": { model: "Product", entity: "PRODUCT" },
  "product.delete": { model: "Product", entity: "PRODUCT" },
  "category.create": { model: "Category", entity: "CATEGORY" },
  "category.update": { model: "Category", entity: "CATEGORY" },
  "category.delete": { model: "Category", entity: "CATEGORY" },
  "facet.create": { model: "Facet", entity: "FACET" },
  "facet.update": { model: "Facet", entity: "FACET" },
  "facet.delete": { model: "Facet", entity: "FACET" },
  "facet.value_create": { model: "FacetValue", entity: "FACET_VALUE" },
  "facet.value_update": { model: "FacetValue", entity: "FACET_VALUE" },
  "facet.value_delete": { model: "FacetValue", entity: "FACET_VALUE" },
  "content.page.create": { model: "ContentPage", entity: "CONTENT_PAGE" },
  "content.page.update": { model: "ContentPage", entity: "CONTENT_PAGE" },
  "content.page.duplicate": { model: "ContentPage", entity: "CONTENT_PAGE" },
  "content.page.delete": { model: "ContentPage", entity: "CONTENT_PAGE" },
  "content.menu.create": { model: "MenuItem", entity: "MENU_ITEM" },
  "content.menu.update": { model: "MenuItem", entity: "MENU_ITEM" },
  "content.menu.delete": { model: "MenuItem", entity: "MENU_ITEM" },
};

/** Bulk changes: re-check everything changed in the last two hours. */
const TENANT_WIDE = new Set(["import.done", "import.published", "import.products_done", "facet.seed_defaults", "facet.convert_tags", "facet.value_merge", "content.systemPages.ensure"]);

const ID = /^[a-z0-9]{20,40}$/;

export type TranslationHook = { kind: "entity"; entity: TranslationEntityName; entityId: string } | { kind: "tenant" } | null;

/** Which sync an audited action needs (pure; exported for tests). */
export function translationHookFor(action: string, model: string | undefined, entityId: string | number | undefined): TranslationHook {
  const m = ENTITY_ACTIONS[action];
  if (m && model === m.model && typeof entityId === "string" && ID.test(entityId)) return { kind: "entity", entity: m.entity, entityId };
  if (TENANT_WIDE.has(action)) return { kind: "tenant" };
  return null;
}

/** audit() → translation rows. Never throws. */
export async function onAudited(entry: { action: string; tenantId?: string | null; entity?: string; entityId?: string | number }): Promise<void> {
  if (!entry.tenantId || process.env.TRANSLATIONS === "off") return;
  const hook = translationHookFor(entry.action, entry.entity, entry.entityId);
  if (!hook) return;
  try {
    if (!(await getSettings(entry.tenantId, "i18n")).locales.length) return;
    if (hook.kind === "entity") {
      await enqueue(
        "translations.sync",
        { tenantId: entry.tenantId, entity: hook.entity, entityIds: [hook.entityId] },
        { singletonKey: `${hook.entity}:${hook.entityId}`, startAfter: 5 },
      );
    } else {
      await enqueue("translations.sync", { tenantId: entry.tenantId, scope: "recent" }, { singletonKey: `tenant:${entry.tenantId}`, startAfter: 60 });
    }
  } catch (err) {
    console.error(`[translations] hook for ${entry.action} failed`, err);
  }
}
