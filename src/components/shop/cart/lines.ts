import "server-only";
import { productHref } from "@/server/storefront/products";
import { minutesUntil, type CartView } from "@/server/cart";
import type { CartLineData } from "./CartLineItem";

/** Maps the cart service view to the serialisable rows the cart UI renders. */
export function toCartLineData(cart: CartView, opts: { guest: boolean; blurSensitiveForGuests: boolean; showStockCode?: boolean }): CartLineData[] {
  return cart.lines.map((l) => {
    const locked = l.blurred && opts.guest && opts.blurSensitiveForGuests;
    return {
      productId: l.productId,
      stockCode: opts.showStockCode === false ? null : l.stockCode,
      title: l.title,
      href: productHref(l),
      price: l.price,
      listPrice: l.listPrice,
      offerApplied: l.offerApplied,
      offerExpired: l.offerExpired,
      currency: cart.currency,
      imageUrl: locked ? null : l.imageUrl,
      imageAlt: l.imageAlt ?? l.title,
      blurDataUrl: l.blurDataUrl,
      locked,
      state: l.state,
      expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null,
      takenMinutes: l.state === "taken" && l.expiresAt ? minutesUntil(l.expiresAt) : null,
    };
  });
}
