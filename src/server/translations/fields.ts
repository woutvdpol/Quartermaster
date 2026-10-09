/*
 * What gets translated (docs/i18n.md § Vertalen). Pure: shared by the write side (this folder), the
 * admin UI and the shop's read side (src/server/translations/read.ts).
 *
 * Read contract (Translation table): one row per (tenantId, entity, entityId, field, locale).
 * The shop shows `value` only when `status = APPROVED` (also when `stale`: the source changed after
 * approval and the reviewer has not looked again yet). QUEUED and MACHINE rows are never shown.
 * `field` names are the logical names below — FACET_VALUE "label" is the FacetValue.name column.
 */
import { EXTRA_LOCALES, type ExtraLocale } from "@/lib/i18n/shop-locales";

export type TranslationEntityName = "PRODUCT" | "CATEGORY" | "FACET" | "FACET_VALUE" | "CONTENT_PAGE" | "MENU_ITEM";

export const TRANSLATABLE_FIELDS = {
  PRODUCT: ["title", "description", "seoTitle", "seoDescription"],
  CATEGORY: ["title", "description", "seoTitle", "seoDescription"],
  FACET: ["name"],
  FACET_VALUE: ["label"],
  CONTENT_PAGE: ["title", "seoTitle", "seoDescription"],
  MENU_ITEM: ["label"],
} as const satisfies Record<TranslationEntityName, readonly string[]>;

export type TranslatableField<E extends TranslationEntityName = TranslationEntityName> = (typeof TRANSLATABLE_FIELDS)[E][number];

export const TRANSLATION_ENTITIES = Object.keys(TRANSLATABLE_FIELDS) as TranslationEntityName[];

/** Fields stored as Markdown: translated per text segment, structure kept. */
const MARKDOWN = new Set(["PRODUCT.description", "CATEGORY.description"]);

export function isMarkdownField(entity: TranslationEntityName, field: string): boolean {
  return MARKDOWN.has(`${entity}.${field}`);
}

export function isTranslatableField(entity: TranslationEntityName, field: string): boolean {
  return (TRANSLATABLE_FIELDS[entity] as readonly string[]).includes(field);
}

export const TRANSLATION_LOCALES = EXTRA_LOCALES;
export type TranslationLocale = ExtraLocale;

export const LOCALE_LABELS: Record<TranslationLocale, string> = { nl: "Dutch", de: "German" };

export const ENTITY_LABELS: Record<TranslationEntityName, string> = {
  PRODUCT: "Product",
  CATEGORY: "Category",
  FACET: "Facet",
  FACET_VALUE: "Facet value",
  CONTENT_PAGE: "Page",
  MENU_ITEM: "Menu item",
};

export const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  seoTitle: "SEO title",
  seoDescription: "SEO description",
  name: "Name",
  label: "Label",
};
