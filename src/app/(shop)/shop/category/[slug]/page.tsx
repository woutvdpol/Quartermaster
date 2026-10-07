import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/shop/ui";
import { requireShop } from "@/server/storefront/context";
import { CatalogView, defaultSortFor } from "@/components/shop/catalog/CatalogView";
import { catalogCopy as copy } from "@/components/shop/catalog/_copy";
import { catalogMetadata } from "@/components/shop/catalog/metadata";
import { markdownToPlainText } from "@/server/content/markdown";
import {
  SHOP_PATH,
  categoryHref,
  categoryPath,
  getCategoryBySlug,
  getCategoryTree,
  hasActiveFilters,
  parseCatalogParams,
} from "@/server/storefront-catalog";

/** The category plus its root→leaf path in the public tree; 404 when hidden (inactive itself or an ancestor). */
async function loadCategory(tenantId: string, rawSlug: string) {
  const slug = decodeURIComponent(rawSlug).toLowerCase();
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) notFound();
  const [category, tree] = await Promise.all([getCategoryBySlug(tenantId, slug), getCategoryTree(tenantId)]);
  if (!category) notFound();
  const path = categoryPath(tree, category.id);
  if (!path.length) notFound();
  return { category, path };
}

export async function generateMetadata({ params, searchParams }: PageProps<"/shop/category/[slug]">): Promise<Metadata> {
  const shop = await requireShop();
  const { slug } = await params;
  const { category } = await loadCategory(shop.tenant.id, slug);
  const query = parseCatalogParams(await searchParams, defaultSortFor(shop, "shop"));
  const description =
    category.seoDescription || (category.description ? markdownToPlainText(category.description).slice(0, 160) : null) || copy.shop.metaDescription(shop.shopName);
  return catalogMetadata({ path: categoryHref(category.slug), params: query, title: category.seoTitle || category.title, description });
}

export default async function CategoryPage({ params, searchParams }: PageProps<"/shop/category/[slug]">) {
  const shop = await requireShop();
  const { slug } = await params;
  const { category, path } = await loadCategory(shop.tenant.id, slug);
  const sp = await searchParams;
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
      intro={showIntro ? <Markdown source={category.description} /> : null}
      crumbs={[
        { label: copy.shop.title, href: SHOP_PATH },
        ...path.map((n, i) => ({ label: n.title, href: i < path.length - 1 ? categoryHref(n.slug) : null })),
      ]}
    />
  );
}
