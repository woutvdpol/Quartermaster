"use server";

import { getShopContext } from "@/server/storefront/context";
import { getCart, getShopViewer } from "@/server/cart";
import { readCartToken } from "@/server/cart/cookie";
import { toCartLineData } from "./lines";
import type { CartLineData } from "./CartLineItem";

export type MiniCartData = {
  lines: CartLineData[];
  /** Lines that can still be bought. */
  count: number;
  subtotal: number;
  currency: string;
  /** Earliest end of this visitor's reservations (ISO), for "reserved for N min". */
  earliestExpiry: string | null;
};

/**
 * Read-only cart preview for the header's hover panel. Same data and visibility rules as the cart
 * page (sensitive items stay blurred for guests); tenant from the host, cart from the cookie.
 */
export async function getMiniCartAction(): Promise<MiniCartData | null> {
  const shop = await getShopContext();
  if (!shop) return null;
  const tenantId = shop.tenant.id;
  const token = await readCartToken();
  const [cart, viewer] = await Promise.all([getCart(tenantId, token), getShopViewer(tenantId)]);
  if (!cart) return { lines: [], count: 0, subtotal: 0, currency: shop.tenant.currency, earliestExpiry: null };
  return {
    lines: toCartLineData(cart, {
      guest: !viewer,
      blurSensitiveForGuests: shop.settings.legal.blurSensitiveForGuests,
      showStockCode: shop.settings.catalog.showStockCode,
    }),
    count: cart.buyableCount,
    subtotal: cart.subtotal,
    currency: cart.currency,
    earliestExpiry: cart.earliestExpiry ? cart.earliestExpiry.toISOString() : null,
  };
}
