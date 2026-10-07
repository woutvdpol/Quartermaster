import type { CardOptions } from "@/server/storefront/products";
import type { ShopContext } from "@/server/storefront/context";

/** What every block may need besides its own data. Built once per page by `blockContext()`. */
export type BlockContext = {
  tenantId: string;
  shopName: string;
  card: CardOptions;
  gridColumns: 3 | 4;
  showStockCode: boolean;
  /** Fallback hero image (appearance.bannerPath) — only when the page shows the banner. */
  bannerPath: string | null;
  newsletterEnabled: boolean;
};

export function blockContext(shop: ShopContext, opts: { viewerSignedIn: boolean; withBanner: boolean }): BlockContext {
  const s = shop.settings;
  return {
    tenantId: shop.tenant.id,
    shopName: shop.shopName,
    card: {
      currency: shop.tenant.currency,
      viewerSignedIn: opts.viewerSignedIn,
      blurSensitiveForGuests: s.legal.blurSensitiveForGuests,
      showPriceWhenSold: s.catalog.showPriceWhenSold,
    },
    gridColumns: s.catalog.gridColumns,
    showStockCode: s.catalog.showStockCode,
    bannerPath: opts.withBanner ? s.appearance.bannerPath : null,
    newsletterEnabled: s.features.newsletter,
  };
}
