/*
 * Shop read side of translations — pure parts (tags, fallback). docs/i18n.md § Shop-routing.
 * The cached DB reads live in ./read.ts. Pure so src/server/storefront/cache.ts and tests can use it.
 */
import type { ShopLocale } from "@/lib/i18n/shop-locales";

/**
 * Cache tag of a tenant's approved translations: all languages (`tenant:{id}:translations`) or one
 * (`tenant:{id}:translations:{locale}`). Every shop translation read carries both, plus `tenant:{id}`.
 * The write side invalidates with `revalidateTag(translationsTag(tenantId), { expire: 0 })` after an
 * approval / edit / un-approval (or simply audits a `translation.*` action — see shopTagsForAction).
 */
export function translationsTag(tenantId: string, locale?: ShopLocale): string {
  return locale ? `tenant:${tenantId}:translations:${locale}` : `tenant:${tenantId}:translations`;
}

/** Approved values: entityId → field → text. Missing = show the English source. */
export type TranslationValues = Record<string, Record<string, string>>;

export const NO_TRANSLATIONS: TranslationValues = Object.freeze({}) as TranslationValues;

/** The approved translation of one field, else the English `source` (also for empty values). */
export function translatedText<S extends string | null | undefined>(values: TranslationValues, id: string, field: string, source: S): string | S {
  const v = values[id]?.[field];
  return v && v.trim() !== "" ? v : source;
}

/** Is a non-empty approved translation of this field available? */
export function hasTranslation(values: TranslationValues, id: string, field: string): boolean {
  const v = values[id]?.[field];
  return !!v && v.trim() !== "";
}

/** Rows (as read from the DB) → TranslationValues. Rows with an empty value are skipped. */
export function toTranslationValues(rows: readonly { entityId: string; field: string; value: string | null }[]): TranslationValues {
  const out: TranslationValues = {};
  for (const r of rows) {
    if (!r.value || r.value.trim() === "") continue;
    (out[r.entityId] ??= {})[r.field] = r.value;
  }
  return out;
}

/** Cache-key normalisation: unique, sorted, non-empty ids. */
export function normalizeIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === "string" && id !== ""))].sort();
}
