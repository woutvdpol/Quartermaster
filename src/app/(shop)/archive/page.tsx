import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireShop } from "@/server/storefront/context";
import { CatalogView, defaultSortFor } from "@/components/shop/catalog/CatalogView";
import { catalogCopy as copy } from "@/components/shop/catalog/_copy";
import { catalogMetadata } from "@/components/shop/catalog/metadata";
import { ARCHIVE_PATH, SHOP_PATH, parseCatalogParams } from "@/server/storefront-catalog";

/**
 * Sold archive (settings.catalog.publicArchive, docs/sold-archive.md): SOLD items not hidden per item,
 * most recently sold first, with the catalog's search, categories, facets and compliance rules.
 * Prices only on items where the dealer ticked "show sold price".
 */
export async function generateMetadata({ searchParams }: PageProps<"/archive">): Promise<Metadata> {
  const shop = await requireShop();
  if (!shop.settings.catalog.publicArchive) return {};
  const defaultSort = defaultSortFor(shop, "archive");
  const params = parseCatalogParams(await searchParams, defaultSort);
  return catalogMetadata({ shop, defaultSort, path: ARCHIVE_PATH, params, title: copy.archive.title, description: copy.archive.metaDescription(shop.shopName) });
}

export default async function ArchivePage({ searchParams }: PageProps<"/archive">) {
  const shop = await requireShop();
  if (!shop.settings.catalog.publicArchive) notFound();
  const sp = await searchParams;
  return (
    <CatalogView
      shop={shop}
      mode="archive"
      basePath={ARCHIVE_PATH}
      searchParams={sp}
      title={copy.archive.title}
      intro={<p>{copy.archive.intro}</p>}
      crumbs={[{ label: copy.shop.title, href: SHOP_PATH }, { label: copy.archive.title }]}
    />
  );
}
