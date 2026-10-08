import "server-only";
import { headers } from "next/headers";
import { complianceHideFilter, resolveCompliance, visitorCountry } from "@/server/compliance";
import { getShopContext, type ShopContext } from "@/server/storefront/context";
import { getOpenShopTenant } from "@/server/storefront/launch";
import { getShopViewer } from "@/server/storefront/viewer";
import { applyGeoBlur, toCardData } from "@/components/shop/catalog/to-card";
import type { ProductCardData } from "@/components/shop/ui";
import { currencyExponent } from "@/components/shop/ui/money";
import { liveReservedIds, withLiveStatus, type ListScope } from "@/server/storefront-catalog";
import type { CatalogCard } from "@/server/storefront-catalog/types";

/*
 * Request-side helpers for the search route handlers (and any other storefront caller): the shop of
 * the request (null while "coming soon" for visitors), the catalog scope for this visitor (country
 * compliance hiding) and card mapping with the same lock/blur rules as the catalog grid — locked
 * cards never carry a real image URL.
 */

export type SearchRequestContext = {
  shop: ShopContext;
  scope: ListScope;
  country: string | null;
  lockSensitive: boolean;
};

export async function searchRequestContext(): Promise<SearchRequestContext | null> {
  const tenant = await getOpenShopTenant();
  if (!tenant) return null;
  const shop = await getShopContext();
  if (!shop || shop.tenant.id !== tenant.id) return null;
  const country = visitorCountry(await headers());
  const [hide, viewer] = await Promise.all([complianceHideFilter(shop.tenant.id, country), getShopViewer(shop.tenant.id)]);
  return {
    shop,
    country,
    lockSensitive: shop.settings.legal.blurSensitiveForGuests && !viewer,
    scope: { mode: "shop", categoryIds: null, priceUnit: 10 ** currencyExponent(shop.tenant.currency), hide },
  };
}

/** Catalog cards → ProductCard data (live reservations, sensitive lock, country blur). */
export async function toPublicCards(ctx: SearchRequestContext, cards: CatalogCard[]): Promise<ProductCardData[]> {
  const tenantId = ctx.shop.tenant.id;
  const ids = cards.map((c) => c.id);
  const [reserved, verdicts] = await Promise.all([
    liveReservedIds(tenantId, ids),
    ctx.country ? resolveCompliance(tenantId, ids, ctx.country) : Promise.resolve({} as Awaited<ReturnType<typeof resolveCompliance>>),
  ]);
  const cardCtx = { currency: ctx.shop.tenant.currency, showPriceWhenSold: ctx.shop.settings.catalog.showPriceWhenSold, lockSensitive: ctx.lockSensitive };
  return withLiveStatus(cards, reserved).map((c) => applyGeoBlur(toCardData(c, cardCtx), c, verdicts[c.id]?.blurred ?? false));
}
