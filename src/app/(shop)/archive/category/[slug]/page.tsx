import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireShop } from "@/server/storefront/context";
import { CatalogView, defaultSortFor } from "@/components/shop/catalog/CatalogView";
import { catalogCopies } from "@/components/shop/catalog/_copy";
import { pickCopy } from "@/lib/i18n/shop-copy";
import { catalogMetadata } from "@/components/shop/catalog/metadata";
import { translateCategory, translateCategoryTree } from "@/server/storefront/translate";
import { ARCHIVE_PATH, archiveCategoryHref, categoryPath, getCategoryBySlug, getCategoryTree, parseCatalogParams, type RawSearchParams } from "@/server/storefront-catalog";

// Spelled out (not PageProps<…>): the generated route types only learn this route on the next build.
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> };

/** The category plus its root→leaf path in the public tree; 404 when hidden or when the archive is off. */
async function load(rawSlug: string) {
  const shop = await requireShop();
  if (!shop.settings.catalog.publicArchive) notFound();
  const slug = decodeURIComponent(rawSlug).toLowerCase();
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) notFound();
  const [source, tree] = await Promise.all([
    getCategoryBySlug(shop.tenant.id, slug),
    // Titles in the shop language (approved translations; docs/i18n.md).
    getCategoryTree(shop.tenant.id).then((t) => translateCategoryTree(shop.tenant.id, shop.locale, t)),
  ]);
  if (!source) notFound();
  const path = categoryPath(tree, source.id);
  if (!path.length) notFound();
  const { category } = await translateCategory(shop.tenant.id, shop.locale, source);
  return { shop, category, path };
}

/** Sold archive of one category (and its subcategories) — docs/sold-archive.md. */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { shop, category } = await load((await params).slug);
  const copy = pickCopy(catalogCopies, shop.locale);
  const defaultSort = defaultSortFor(shop, "archive");
  const query = parseCatalogParams(await searchParams, defaultSort);
  return catalogMetadata({
    shop,
    defaultSort,
    path: archiveCategoryHref(category.slug),
    params: query,
    title: copy.archive.categoryTitle(category.title),
    description: copy.archive.categoryMetaDescription(category.title, shop.shopName),
  });
}

export default async function ArchiveCategoryPage({ params, searchParams }: Props) {
  const { shop, category, path } = await load((await params).slug);
  const copy = pickCopy(catalogCopies, shop.locale);
  return (
    <CatalogView
      shop={shop}
      mode="archive"
      basePath={archiveCategoryHref(category.slug)}
      category={category}
      searchParams={await searchParams}
      title={copy.archive.categoryTitle(category.title)}
      crumbs={[
        { label: copy.archive.title, href: ARCHIVE_PATH },
        ...path.map((n, i) => ({ label: n.title, href: i < path.length - 1 ? archiveCategoryHref(n.slug) : null })),
      ]}
    />
  );
}
