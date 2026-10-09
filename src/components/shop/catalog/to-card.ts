import type { ProductCardData, ShopImage } from "@/components/shop/ui";
import type { CatalogCard, PublicImage } from "@/server/storefront-catalog/types";
import { priceVisible, soldLabel } from "@/server/storefront-catalog/sold";
import type { ShopLocale } from "@/lib/i18n/shop-locales";

export type CardContext = {
  currency: string;
  /** Blur sensitive items (legal.blurSensitiveForGuests && viewer may not see them). */
  lockSensitive: boolean;
  /** Shop time zone for "Sold Oct 2026" (default UTC). */
  timeZone?: string;
  /** Visitor language for the sold label (default English). */
  locale?: ShopLocale;
};

export function toShopImage(img: PublicImage, alt: string): ShopImage {
  return {
    src: img.card,
    srcSet: `${img.thumb} 320w, ${img.card} 800w, ${img.large} 2000w`,
    sources: img.sources,
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
    // Sold items: price only when the dealer ticked "show sold price" on the item (docs/sold-archive.md).
    showPrice: priceVisible(c),
    soldLabel: c.status === "sold" ? soldLabel(c.soldAt, ctx.timeZone, ctx.locale) : null,
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

/**
 * Visitor-country compliance (BLUR_IMAGES rule): the card shows only the tiny `blur` variant scaled
 * up (no sharp URL is sent), without the "Log in to view" label — logging in does not lift a
 * country rule. Locked cards are already blurred.
 */
export function applyGeoBlur(card: ProductCardData, c: CatalogCard, blurred: boolean): ProductCardData {
  if (!blurred || card.locked || !c.cover) return card;
  return {
    ...card,
    image: { src: c.cover.blur, blurDataUrl: c.cover.blurDataUrl, alt: "", width: c.cover.width, height: c.cover.height },
  };
}
