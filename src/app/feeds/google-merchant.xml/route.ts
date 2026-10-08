import { getSeoScope, notFoundResponse, textResponse } from "@/server/seo/http";
import { FEED_PAGE_SIZE, MAX_PAGES, getFeedProductCount, getFeedProductsPage, shopCountry, shopDescription, type FeedProductRow } from "@/server/seo";
import { categoryPath, getCategoryTree, productHref } from "@/server/storefront-catalog";
import { merchantFeedXml, type FeedItem } from "@/lib/seo/merchant-feed";

/*
 * Google Merchant Center product feed of the request's shop: /feeds/google-merchant.xml (stable URL;
 * register it as a scheduled fetch in Merchant Center). Buyable items only — see
 * src/lib/seo/merchant-feed.ts for the exclusions. Built from cached pages (FEED_PAGE_SIZE rows).
 */
export async function GET() {
  const scope = await getSeoScope();
  if (scope.kind !== "shop") return notFoundResponse();
  const { shop } = scope;
  const id = shop.tenant.id;
  const [count, tree] = await Promise.all([getFeedProductCount(id), getCategoryTree(id)]);
  const pages = Math.min(Math.ceil(count / FEED_PAGE_SIZE), MAX_PAGES);
  const rows: FeedProductRow[] = [];
  for (let page = 0; page < pages; page++) rows.push(...(await getFeedProductsPage(id, shopCountry(shop), page)));

  const abs = (path: string) => new URL(path, shop.origin).toString();
  const items: FeedItem[] = rows.map((r) => ({
    stockCode: r.stockCode,
    title: r.title,
    description: r.description,
    link: abs(productHref(r)),
    images: r.images.map(abs),
    price: r.price,
    categoryPath: r.categoryId ? categoryPath(tree, r.categoryId).map((n) => n.title) : [],
    brand: r.brand,
    weightGrams: r.weightGrams,
  }));
  return textResponse(
    merchantFeedXml({ name: shop.shopName, origin: shop.origin, currency: shop.tenant.currency, description: shopDescription(shop) }, items),
    "application/xml",
  );
}
