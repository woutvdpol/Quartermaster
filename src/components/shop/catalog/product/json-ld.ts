import { currencyExponent } from "@/components/shop/ui/money";
import { markdownToPlainText } from "@/server/content/markdown";
import type { PublicProduct, PublicStatus } from "@/server/storefront-catalog/types";

type ShopLike = { origin: string; shopName: string; tenant: { currency: string }; settings: { catalog: { showPriceWhenSold: boolean } } };

const AVAILABILITY: Record<PublicStatus, string> = {
  available: "https://schema.org/InStock",
  reserved: "https://schema.org/LimitedAvailability",
  sold: "https://schema.org/SoldOut",
};

/** schema.org Product + Offer for a (non-locked) product page. Pure. */
export function productJsonLd(shop: ShopLike, p: PublicProduct, status: PublicStatus) {
  const abs = (path: string) => new URL(path, shop.origin).toString();
  const currency = shop.tenant.currency;
  const showPrice = status !== "sold" || shop.settings.catalog.showPriceWhenSold;
  const exp = currencyExponent(currency);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    url: abs(p.href),
    sku: p.sku ?? String(p.stockCode),
    productID: String(p.stockCode),
    ...(p.description ? { description: markdownToPlainText(p.description).slice(0, 5000) } : {}),
    ...(p.images.length ? { image: p.images.slice(0, 10).map((i) => abs(i.large)) } : {}),
    ...(p.categoryPath.length ? { category: p.categoryPath.map((c) => c.title).join(" > ") } : {}),
    itemCondition: "https://schema.org/UsedCondition",
    offers: {
      "@type": "Offer",
      url: abs(p.href),
      availability: AVAILABILITY[status],
      itemCondition: "https://schema.org/UsedCondition",
      ...(showPrice ? { price: (p.price / 10 ** exp).toFixed(exp), priceCurrency: currency } : {}),
      seller: { "@type": "Organization", name: shop.shopName, url: shop.origin },
    },
  };
}
