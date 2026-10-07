import "server-only";
import { currentCartCount } from "@/server/cart/cookie";
import { currentWishlistCount } from "@/server/wishlist";

/*
 * HAND-OFF POINT for the cart / account agents.
 *
 * The shop header shows a cart count and a wishlist count. The layout calls `getHeaderCounts()` once
 * per request (inside a Suspense boundary, so it never blocks the page) and hands the numbers to the
 * client <HeaderCountsProvider>. Replace the body of this function with the real lookups (cart from
 * the cart cookie, wishlist from the session) — keep the signature.
 *
 * After a client-side mutation (add to cart, toggle wishlist), either call `router.refresh()` /
 * revalidatePath in the server action (the layout re-runs this), or update instantly with the
 * client hook `useHeaderCounts().setCounts({ cart: n })` from "@/components/shop/layout".
 */
export type HeaderCounts = { cart: number; wishlist: number };

export async function getHeaderCounts(tenantId: string): Promise<HeaderCounts> {
  const [cart, wishlist] = await Promise.all([currentCartCount(tenantId), currentWishlistCount(tenantId)]);
  return { cart, wishlist };
}
