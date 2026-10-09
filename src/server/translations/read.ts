import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/server/db";
import { isExtraLocale, type ShopLocale } from "@/lib/i18n/shop-locales";
import type { TranslatableField, TranslationEntityName } from "./fields";
import { NO_TRANSLATIONS, normalizeIds, toTranslationValues, translationsTag, type TranslationValues } from "./read-pure";

/*
 * Shop read side of translations (docs/i18n.md § Shop-routing). Only APPROVED rows are ever read
 * (also when `stale`: the approved text stays online until the reviewer looks again — contract in
 * ./fields.ts). QUEUED and MACHINE values never reach the shop. Where nothing is approved the shop
 * shows the English source (translatedText in ./read-pure.ts).
 *
 * Cached in the data cache per tenant + language + entity (+ ids), tagged:
 *   tenant:{id}                     everything of the tenant
 *   tenant:{id}:translations        all languages  ← invalidate this on approve/edit/unapprove
 *   tenant:{id}:translations:{nl|de}
 * English requests never query.
 */

export { translationsTag, translatedText, hasTranslation, type TranslationValues } from "./read-pure";

/** Safety TTL; approvals invalidate the tag immediately. */
const TRANSLATION_CACHE_SECONDS = 300;

async function queryApproved(tenantId: string, entity: TranslationEntityName, locale: string, fields: string[], ids: string[] | null) {
  const rows = await db.translation.findMany({
    where: {
      tenantId,
      entity,
      locale,
      status: "APPROVED",
      field: { in: fields },
      ...(ids ? { entityId: { in: ids } } : {}),
    },
    select: { entityId: true, field: true, value: true },
  });
  return toTranslationValues(rows);
}

function cached(tenantId: string, locale: ShopLocale, key: string[], load: () => Promise<TranslationValues>): Promise<TranslationValues> {
  return unstable_cache(load, ["translations", tenantId, locale, ...key], {
    tags: [`tenant:${tenantId}`, translationsTag(tenantId), translationsTag(tenantId, locale)],
    revalidate: TRANSLATION_CACHE_SECONDS,
  })();
}

/**
 * Approved translations of some entities: `getApprovedTranslations(tenantId, "PRODUCT", ids, ["title"], "de")`
 * → { [productId]: { title: "Stahlhelm M40" } }. English (or an unknown language) → {} without a query.
 * One query per call; the result is cached per (tenant, language, entity, fields, sorted ids).
 */
export async function getApprovedTranslations<E extends TranslationEntityName>(
  tenantId: string,
  entity: E,
  ids: readonly string[],
  fields: readonly TranslatableField<E>[],
  locale: ShopLocale,
): Promise<TranslationValues> {
  if (!isExtraLocale(locale)) return NO_TRANSLATIONS;
  const idList = normalizeIds(ids);
  const fieldList = [...new Set(fields as readonly string[])].sort();
  if (!idList.length || !fieldList.length) return NO_TRANSLATIONS;
  return cached(tenantId, locale, [entity, fieldList.join(","), idList.join(",")], () => queryApproved(tenantId, entity, locale, fieldList, idList));
}

/**
 * All approved translations of one entity type (small taxonomies: categories, facets, facet values,
 * menu items). One cache entry per (tenant, language, entity, fields).
 */
export async function getAllApprovedTranslations<E extends TranslationEntityName>(
  tenantId: string,
  entity: E,
  fields: readonly TranslatableField<E>[],
  locale: ShopLocale,
): Promise<TranslationValues> {
  if (!isExtraLocale(locale)) return NO_TRANSLATIONS;
  const fieldList = [...new Set(fields as readonly string[])].sort();
  if (!fieldList.length) return NO_TRANSLATIONS;
  return cached(tenantId, locale, [entity, fieldList.join(","), "*"], () => queryApproved(tenantId, entity, locale, fieldList, null));
}
