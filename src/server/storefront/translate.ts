import "server-only";
import type { ShopLocale } from "@/lib/i18n/shop-locales";
import { isExtraLocale } from "@/lib/i18n/shop-locales";
import { getAllApprovedTranslations, getApprovedTranslations } from "@/server/translations/read";
import { hasTranslation, translatedText, type TranslationValues } from "@/server/translations/read-pure";
import { flattenTree, getCategoryTree } from "@/server/storefront-catalog";
import type {
  CatalogFacets,
  FacetGroup,
  FacetValueOption,
  ProductFacet,
  PublicCategory,
  PublicCategoryNode,
  PublicProduct,
  PublicTaxonomy,
} from "@/server/storefront-catalog/types";
import type { PublicMenuItem, ShopMenus, StorefrontPage } from "./content";

/*
 * Owner content in the shop language (docs/i18n.md § Shop-routing): overlays APPROVED translations
 * (src/server/translations/read.ts) on the cached English DTOs. The English caches stay as they are;
 * translations are cached separately per tenant + language, so no existing cache key changes.
 * Anything without an approved translation keeps its English text. English requests return the
 * input unchanged without any query.
 */

// ─── Taxonomy (whole entity per tenant + language) ──────────────────────────

const categoryTitles = (tenantId: string, locale: ShopLocale) => getAllApprovedTranslations(tenantId, "CATEGORY", ["title"], locale);
const facetNames = (tenantId: string, locale: ShopLocale) => getAllApprovedTranslations(tenantId, "FACET", ["name"], locale);
const valueLabels = (tenantId: string, locale: ShopLocale) => getAllApprovedTranslations(tenantId, "FACET_VALUE", ["label"], locale);

function mapTree(nodes: PublicCategoryNode[], t: TranslationValues): PublicCategoryNode[] {
  return nodes.map((n) => ({ ...n, title: translatedText(t, n.id, "title", n.title), children: mapTree(n.children, t) }));
}

/** Category tree (menus, sidebar, breadcrumbs) with translated titles. */
export async function translateCategoryTree(tenantId: string, locale: ShopLocale, tree: PublicCategoryNode[]): Promise<PublicCategoryNode[]> {
  if (!isExtraLocale(locale)) return tree;
  return mapTree(tree, await categoryTitles(tenantId, locale));
}

/** One category page: title + description + SEO texts; `translated` lists the fields that are. */
export async function translateCategory(
  tenantId: string,
  locale: ShopLocale,
  category: PublicCategory,
): Promise<{ category: PublicCategory; translated: Set<string> }> {
  if (!isExtraLocale(locale)) return { category, translated: new Set() };
  const t = await getApprovedTranslations(tenantId, "CATEGORY", [category.id], ["title", "description", "seoTitle", "seoDescription"], locale);
  const translated = new Set(["title", "description", "seoTitle", "seoDescription"].filter((f) => hasTranslation(t, category.id, f)));
  return {
    category: {
      ...category,
      title: translatedText(t, category.id, "title", category.title),
      description: translatedText(t, category.id, "description", category.description),
      seoTitle: translatedText(t, category.id, "seoTitle", category.seoTitle),
      seoDescription: translatedText(t, category.id, "seoDescription", category.seoDescription),
    },
    translated,
  };
}

function mapValues(values: FacetValueOption[], t: TranslationValues): FacetValueOption[] {
  return values.map((v) => ({ ...v, name: translatedText(t, v.id, "label", v.name), children: mapValues(v.children, t) }));
}

/** Facet groups of the filter sidebar (facet names + value labels). */
export async function translateFacetGroups(tenantId: string, locale: ShopLocale, groups: FacetGroup[]): Promise<FacetGroup[]> {
  if (!isExtraLocale(locale) || !groups.length) return groups;
  const [names, labels] = await Promise.all([facetNames(tenantId, locale), valueLabels(tenantId, locale)]);
  return groups.map((g) => ({ ...g, name: translatedText(names, g.id, "name", g.name), values: mapValues(g.values, labels) }));
}

/** CatalogFacets with translated facet groups (counts/tags/price untouched; tags are not translated). */
export async function translateCatalogFacets(tenantId: string, locale: ShopLocale, facets: CatalogFacets): Promise<CatalogFacets> {
  if (!isExtraLocale(locale)) return facets;
  return { ...facets, facets: await translateFacetGroups(tenantId, locale, facets.facets) };
}

/** Shop taxonomy (landing pages, chips). */
export async function translateTaxonomy(tenantId: string, locale: ShopLocale, tax: PublicTaxonomy): Promise<PublicTaxonomy> {
  if (!isExtraLocale(locale)) return tax;
  const [names, labels] = await Promise.all([facetNames(tenantId, locale), valueLabels(tenantId, locale)]);
  return {
    facets: tax.facets.map((f) => ({ ...f, name: translatedText(names, f.id, "name", f.name) })),
    values: tax.values.map((v) => ({ ...v, name: translatedText(labels, v.id, "label", v.name) })),
  };
}

// ─── Products ───────────────────────────────────────────────────────────────

/** Category title by slug (cards only carry { title, slug }). */
async function categoryTitleBySlug(tenantId: string, locale: ShopLocale): Promise<Map<string, string>> {
  const [tree, titles] = await Promise.all([getCategoryTree(tenantId), categoryTitles(tenantId, locale)]);
  const out = new Map<string, string>();
  for (const n of flattenTree(tree)) if (hasTranslation(titles, n.id, "title")) out.set(n.slug, titles[n.id].title);
  return out;
}

/** Catalog cards (grids, rails, wishlist, search): translated titles and category names. */
export async function translateCards<C extends { id: string; title: string; category: { title: string; slug?: string } | null }>(
  tenantId: string,
  locale: ShopLocale,
  cards: C[],
): Promise<C[]> {
  if (!isExtraLocale(locale) || !cards.length) return cards;
  const [titles, categories] = await Promise.all([
    getApprovedTranslations(tenantId, "PRODUCT", cards.map((c) => c.id), ["title"], locale),
    categoryTitleBySlug(tenantId, locale),
  ]);
  return cards.map((c) => ({
    ...c,
    title: translatedText(titles, c.id, "title", c.title),
    category: c.category ? { ...c.category, title: (c.category.slug && categories.get(c.category.slug)) || c.category.title } : c.category,
  }));
}

/** Product titles by id (search hits, cart lines, other id-keyed lists): id → translated title (only translated ones). */
export async function translatedProductTitles(tenantId: string, locale: ShopLocale, ids: string[]): Promise<Map<string, string>> {
  if (!isExtraLocale(locale) || !ids.length) return new Map();
  const t = await getApprovedTranslations(tenantId, "PRODUCT", ids, ["title"], locale);
  return new Map(Object.entries(t).flatMap(([id, f]) => (f.title ? [[id, f.title] as const] : [])));
}

async function translateProductFacets(tenantId: string, locale: ShopLocale, facets: ProductFacet[]): Promise<ProductFacet[]> {
  if (!facets.length) return facets;
  const [names, labels] = await Promise.all([facetNames(tenantId, locale), valueLabels(tenantId, locale)]);
  return facets.map((f) => ({
    ...f,
    facet: { ...f.facet, name: translatedText(names, f.facet.id, "name", f.facet.name) },
    values: f.values.map((v) => ({ ...v, name: translatedText(labels, v.id, "label", v.name) })),
  }));
}

export type TranslatedProduct = {
  product: PublicProduct;
  /** The description shown is a translation (the "Translated from English · Show original" note). */
  descriptionTranslated: boolean;
  /** A translated description exists (also when the visitor asked for the original). */
  descriptionTranslatable: boolean;
};

/**
 * Product page in the shop language: title, description, SEO texts, category path and facet labels.
 * `original: true` (?original=1) keeps the English title/description/SEO texts but still translates
 * the taxonomy around it.
 */
export async function translateProduct(
  tenantId: string,
  locale: ShopLocale,
  product: PublicProduct,
  { original = false }: { original?: boolean } = {},
): Promise<TranslatedProduct> {
  if (!isExtraLocale(locale)) return { product, descriptionTranslated: false, descriptionTranslatable: false };
  const [t, titles, facets] = await Promise.all([
    getApprovedTranslations(tenantId, "PRODUCT", [product.id], ["title", "description", "seoTitle", "seoDescription"], locale),
    categoryTitles(tenantId, locale),
    translateProductFacets(tenantId, locale, product.facets),
  ]);
  const id = product.id;
  const descriptionTranslatable = hasTranslation(t, id, "description");
  const own = original
    ? {}
    : {
        title: translatedText(t, id, "title", product.title),
        description: translatedText(t, id, "description", product.description),
        seoTitle: translatedText(t, id, "seoTitle", product.seoTitle),
        seoDescription: translatedText(t, id, "seoDescription", product.seoDescription),
      };
  return {
    product: {
      ...product,
      ...own,
      categoryPath: product.categoryPath.map((c) => ({ ...c, title: translatedText(titles, c.id, "title", c.title) })),
      facets,
    },
    descriptionTranslated: descriptionTranslatable && !original,
    descriptionTranslatable,
  };
}

// ─── Content ────────────────────────────────────────────────────────────────

function mapMenu(items: PublicMenuItem[], t: TranslationValues): PublicMenuItem[] {
  return items.map((i) => ({ ...i, label: translatedText(t, i.id, "label", i.label), children: mapMenu(i.children, t) }));
}

/** Header + footer menus with translated labels. */
export async function translateMenus(tenantId: string, locale: ShopLocale, menus: ShopMenus): Promise<ShopMenus> {
  if (!isExtraLocale(locale)) return menus;
  const t = await getAllApprovedTranslations(tenantId, "MENU_ITEM", ["label"], locale);
  return { header: mapMenu(menus.header, t), footer: mapMenu(menus.footer, t) };
}

/** CMS page: title and SEO texts (blocks stay as written — they are not machine translated). */
export async function translatePage<P extends StorefrontPage | null>(tenantId: string, locale: ShopLocale, page: P): Promise<P> {
  if (!page || !isExtraLocale(locale)) return page;
  const t = await getApprovedTranslations(tenantId, "CONTENT_PAGE", [page.id], ["title", "seoTitle", "seoDescription"], locale);
  return {
    ...page,
    title: translatedText(t, page.id, "title", page.title),
    seoTitle: translatedText(t, page.id, "seoTitle", page.seoTitle),
    seoDescription: translatedText(t, page.id, "seoDescription", page.seoDescription),
  };
}
