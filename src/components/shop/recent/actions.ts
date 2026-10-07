"use server";

import { getShopContext } from "@/server/storefront/context";
import { liveReservedIds, queryProductsByIds, toProductCardData } from "@/server/storefront/products";
import { getShopViewer } from "@/server/storefront/viewer";
import type { ProductCardData } from "@/components/shop/ui/types";
import { RECENT_MAX, isRecentId } from "./storage";

/**
 * Public, read-only: product cards for the "Recently viewed" strip. Tenant-scoped by request host;
 * only ACTIVE/RESERVED/SOLD products (queryProductsByIds); sensitive items are locked/blurred for
 * guests by toProductCardData. Unknown/foreign ids are dropped. Order follows `ids`.
 */
export async function getRecentlyViewedCards(ids: unknown): Promise<ProductCardData[]> {
  if (!Array.isArray(ids)) return [];
  const clean = [...new Set(ids.filter(isRecentId))].slice(0, RECENT_MAX);
  if (!clean.length) return [];
  const shop = await getShopContext();
  if (!shop) return [];
  const tenantId = shop.tenant.id;
  const [rows, viewer] = await Promise.all([queryProductsByIds(tenantId, clean), getShopViewer(tenantId)]);
  if (!rows.length) return [];
  const reservedIds = await liveReservedIds(
    tenantId,
    rows.filter((r) => r.status === "ACTIVE").map((r) => r.id),
  );
  return rows.map((r) =>
    toProductCardData(r, {
      currency: shop.tenant.currency,
      viewerSignedIn: !!viewer,
      blurSensitiveForGuests: shop.settings.legal.blurSensitiveForGuests,
      showPriceWhenSold: shop.settings.catalog.showPriceWhenSold,
      reservedIds,
    }),
  );
}
