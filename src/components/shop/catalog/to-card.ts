import type { ProductCardData, ShopImage } from "@/components/shop/ui";
import type { CatalogCard, PublicImage } from "@/server/storefront-catalog/types";

export type CardContext = {
  currency: string;
  showPriceWhenSold: boolean;
  /** Blur sensitive items (legal.blurSensitiveForGuests && viewer may not see them). */
  lockSensitive: boolean;
};

export function toShopImage(img: PublicImage, alt: string): ShopImage {
  return {
    src: img.card,
    srcSet: `${img.thumb} 320w, ${img.card} 800w, ${img.large} 2000w`,
    blurDataUrl: img.blurDataUrl,
    alt: img.alt ?? alt,
    width: img.width,
    height: img.height,
  };
}

/** Maps a catalog DTO onto the foundation's ProductCard data. Locked cards never carry real image URLs. */
export function toCardData(c: CatalogCard, ctx: CardContext): ProductCardData {
  const locked = c.blurred && ctx.lockSensitive;
  return {
    id: c.id,
    stockCode: c.stockCode,
    title: c.title,
    href: c.href,
    priceCents: c.price,
    currency: ctx.currency,
    availability: c.status,
    showPrice: c.status !== "sold" || ctx.showPriceWhenSold,
    onSale: c.onSale,
    locked,
    image: c.cover
      ? locked
        ? { src: "", blurDataUrl: c.cover.blurDataUrl, alt: "" } // never leak the real URL
        : toShopImage(c.cover, c.title)
      : null,
    eyebrow: c.category?.title ?? null,
  };
}
