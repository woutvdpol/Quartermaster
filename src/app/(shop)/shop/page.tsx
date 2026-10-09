import type { Metadata } from "next";
import { requireShop } from "@/server/storefront/context";
import { CatalogView, defaultSortFor } from "@/components/shop/catalog/CatalogView";
import { catalogCopies } from "@/components/shop/catalog/_copy";
import { pickCopy } from "@/lib/i18n/shop-copy";
import { catalogMetadata } from "@/components/shop/catalog/metadata";
import { SHOP_PATH, parseCatalogParams } from "@/server/storefront-catalog";
import { JsonLd } from "@/components/shop/ui/JsonLd";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo/json-ld";
import { loadSeoShop } from "@/server/seo";

export async function generateMetadata({ searchParams }: PageProps<"/shop">): Promise<Metadata> {
  const shop = await requireShop();
  const copy = pickCopy(catalogCopies, shop.locale);
  const defaultSort = defaultSortFor(shop, "shop");
  const params = parseCatalogParams(await searchParams, defaultSort);
  return catalogMetadata({
    shop,
    defaultSort,
    path: SHOP_PATH,
    params,
    title: params.q ? copy.shop.searchTitle(params.q) : copy.shop.metaTitle,
    description: copy.shop.metaDescription(shop.shopName),
  });
}

export default async function ShopPage({ searchParams }: PageProps<"/shop">) {
  const shop = await requireShop();
  const copy = pickCopy(catalogCopies, shop.locale);
  const sp = await searchParams;
  const view = <CatalogView shop={shop} mode="shop" basePath={SHOP_PATH} searchParams={sp} title={copy.shop.title} crumbs={[{ label: copy.shop.title }]} />;
  if (!shop.settings.content.homeRedirectsToShop) return view;
  // Home redirects here: the catalog carries the Organization + WebSite entity instead.
  const { seo } = await loadSeoShop(shop);
  return (
    <>
      <JsonLd data={organizationJsonLd(seo)} />
      <JsonLd data={websiteJsonLd(seo)} />
      {view}
    </>
  );
}
