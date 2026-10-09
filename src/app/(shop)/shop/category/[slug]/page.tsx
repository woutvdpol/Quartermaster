import type { Metadata } from "next";
import { Markdown } from "@/components/shop/ui";
import { requireShop } from "@/server/storefront/context";
import { redirectOrNotFound } from "@/server/redirects/runtime";
import { CatalogView, defaultSortFor } from "@/components/shop/catalog/CatalogView";
import { catalogCopies } from "@/components/shop/catalog/_copy";
import { pickCopy } from "@/lib/i18n/shop-copy";
import { catalogMetadata } from "@/components/shop/catalog/metadata";
import { markdownToPlainText } from "@/server/content/markdown";
import type { ShopLocale } from "@/lib/i18n/shop-locales";
import { translateCategory, translateCategoryTree } from "@/server/storefront/translate";
import { ORIGINAL_PARAM, TranslatedNote, wantsOriginal } from "@/components/shop/i18n/TranslatedNote";
import {
  SHOP_PATH,
  categoryHref,
  categoryPath,
  getCategoryBySlug,
  getCategoryTree,
  hasActiveFilters,
  parseCatalogParams,
} from "@/server/storefront-catalog";

/**
 * The category plus its root→leaf path in the public tree; 404 when hidden (inactive itself or an ancestor).
 * Texts in the shop language (approved translations); `original` (?original=1) keeps the English texts.
 */
async function loadCategory(tenantId: string, rawSlug: string, locale: ShopLocale, original = false) {
  const slug = decodeURIComponent(rawSlug).toLowerCase();
  // Unknown (e.g. renamed) category: an owner or legacy redirect may cover the old URL.
  const gone = () => redirectOrNotFound(`/shop/category/${rawSlug}`);
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return gone();
  const [source, tree] = await Promise.all([
    getCategoryBySlug(tenantId, slug),
    getCategoryTree(tenantId).then((t) => translateCategoryTree(tenantId, locale, t)),
  ]);
  if (!source) return gone();
  const path = categoryPath(tree, source.id);
  if (!path.length) return gone();
  const { category, translated } = await translateCategory(tenantId, locale, source);
  const descriptionTranslatable = translated.has("description");
  return { category: original ? source : category, path, descriptionTranslatable };
}

export async function generateMetadata({ params, searchParams }: PageProps<"/shop/category/[slug]">): Promise<Metadata> {
  const shop = await requireShop();
  const copy = pickCopy(catalogCopies, shop.locale);
  const { slug } = await params;
  const sp = await searchParams;
  const original = wantsOriginal(sp[ORIGINAL_PARAM]);
  const { category } = await loadCategory(shop.tenant.id, slug, shop.locale, original);
  const defaultSort = defaultSortFor(shop, "shop");
  const query = parseCatalogParams(sp, defaultSort);
  const description =
    category.seoDescription || (category.description ? markdownToPlainText(category.description) : null) || copy.category.metaDescription(category.title, shop.shopName);
  const meta = catalogMetadata({ shop, defaultSort, path: categoryHref(category.slug), params: query, title: category.seoTitle || copy.category.metaTitle(category.title), description });
  // The English original of a translated page (?original=1) is not indexed; canonical stays the translation.
  return original ? { ...meta, robots: { index: false, follow: true } } : meta;
}

export default async function CategoryPage({ params, searchParams }: PageProps<"/shop/category/[slug]">) {
  const shop = await requireShop();
  const copy = pickCopy(catalogCopies, shop.locale);
  const { slug } = await params;
  const sp = await searchParams;
  const original = wantsOriginal(sp[ORIGINAL_PARAM]);
  const { category, path, descriptionTranslatable } = await loadCategory(shop.tenant.id, slug, shop.locale, original);
  const query = parseCatalogParams(sp, defaultSortFor(shop, "shop"));
  const showIntro = category.description && !hasActiveFilters(query) && query.page === 1 && !query.show;
  return (
    <CatalogView
      shop={shop}
      mode="shop"
      basePath={categoryHref(category.slug)}
      category={category}
      searchParams={sp}
      title={category.title}
      intro={
        showIntro ? (
          <>
            <Markdown source={category.description} />
            {descriptionTranslatable ? <TranslatedNote locale={shop.locale} path={categoryHref(category.slug)} original={original} /> : null}
          </>
        ) : null
      }
      crumbs={[
        { label: copy.shop.title, href: SHOP_PATH },
        ...path.map((n, i) => ({ label: n.title, href: i < path.length - 1 ? categoryHref(n.slug) : null })),
      ]}
    />
  );
}
