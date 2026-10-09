import type { CardOptions } from "@/server/storefront/products";
import type { ShopContext } from "@/server/storefront/context";
import type { ShopLocale } from "@/lib/i18n/shop-locales";

/** What every block may need besides its own data. Built once per page by `blockContext()`. */
export type BlockContext = {
  tenantId: string;
  shopName: string;
  /** Absolute shop origin (JSON-LD links, e.g. the FAQPage answers). */
  origin: string;
  card: CardOptions;
  gridColumns: 3 | 4;
  showStockCode: boolean;
  /** Fallback hero image (appearance.bannerPath) — only when the page shows the banner. */
  bannerPath: string | null;
  newsletterEnabled: boolean;
  /** Visitor language (UI copy, money). */
  locale: ShopLocale;
};

export function blockContext(shop: ShopContext, opts: { viewerSignedIn: boolean; withBanner: boolean }): BlockContext {
  const s = shop.settings;
  return {
    tenantId: shop.tenant.id,
    shopName: shop.shopName,
    origin: shop.origin,
    card: {
      currency: shop.tenant.currency,
      viewerSignedIn: opts.viewerSignedIn,
      blurSensitiveForGuests: s.legal.blurSensitiveForGuests,
    },
    gridColumns: s.catalog.gridColumns,
    showStockCode: s.catalog.showStockCode,
    bannerPath: opts.withBanner ? s.appearance.bannerPath : null,
    newsletterEnabled: s.features.newsletter,
    locale: shop.locale,
  };
}
