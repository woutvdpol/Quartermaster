/**
 * Data shapes the shop UI primitives render. Pure types: server code maps DB rows to these
 * (see `toProductCardData` in src/server/storefront/products.ts) so no Prisma type reaches the client.
 */

/** A responsive image. `src` is the default (card-size) URL; `srcSet` lists width variants. */
export type ShopImage = {
  src: string;
  srcSet?: string;
  /** Inline LQIP (data: URL of the 24px blur variant) shown while loading; null if unprocessed. */
  blurDataUrl: string | null;
  alt: string;
  width?: number | null;
  height?: number | null;
};

/** Sale state of a unique item as the shop shows it. */
export type ProductAvailability = "available" | "reserved" | "sold";

export type ProductCardData = {
  id: string;
  stockCode: number;
  title: string;
  /** Detail URL: /product/{stockCode}/{slug}. */
  href: string;
  priceCents: number;
  /** ISO 4217 shop currency (Tenant.currency). */
  currency: string;
  availability: ProductAvailability;
  /** False hides the price (sold items when catalog.showPriceWhenSold is off). */
  showPrice: boolean;
  onSale: boolean;
  /**
   * Sensitive item viewed by a guest (legal.blurSensitiveForGuests): `image` then only carries the
   * blur placeholder (never the real URL) and the card says "Log in to view".
   */
  locked: boolean;
  image: ShopImage | null;
  /** Small line above the title, e.g. the category name. */
  eyebrow?: string | null;
};

/** Optional indicative price in a display currency. `rate` = units of `currency` per 1 shop-currency unit. */
export type DisplayCurrency = { currency: string; rate: number };
