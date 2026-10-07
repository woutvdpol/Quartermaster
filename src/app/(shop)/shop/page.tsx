import type { Metadata } from "next";
import { requireShop } from "@/server/storefront/context";
import { CatalogView, defaultSortFor } from "@/components/shop/catalog/CatalogView";
import { catalogCopy as copy } from "@/components/shop/catalog/_copy";
import { catalogMetadata } from "@/components/shop/catalog/metadata";
import { SHOP_PATH, parseCatalogParams } from "@/server/storefront-catalog";

export async function generateMetadata({ searchParams }: PageProps<"/shop">): Promise<Metadata> {
  const shop = await requireShop();
  const params = parseCatalogParams(await searchParams, defaultSortFor(shop, "shop"));
  return catalogMetadata({
    path: SHOP_PATH,
    params,
    title: params.q ? copy.shop.searchTitle(params.q) : copy.shop.title,
    description: copy.shop.metaDescription(shop.shopName),
  });
}

export default async function ShopPage({ searchParams }: PageProps<"/shop">) {
  const shop = await requireShop();
  const sp = await searchParams;
  return <CatalogView shop={shop} mode="shop" basePath={SHOP_PATH} searchParams={sp} title={copy.shop.title} crumbs={[{ label: copy.shop.title }]} />;
}
