"use server";

import { logout } from "@/server/auth/service";
import { getShopCustomer } from "@/server/customer-auth";
import { localeRedirect } from "@/server/i18n/locale";
import { toggleWishlist, wishlistProductIds } from "@/server/wishlist";

/*
 * Server actions used by shared account components (AccountMenu, WishlistButton). They are imported
 * by other areas' pages, so they live next to the components rather than in a route folder.
 */

/** Logs out the shop customer. A staff session on the same host is left alone. */
export async function logoutCustomerAction(): Promise<void> {
  if (await getShopCustomer()) await logout();
  await localeRedirect("/");
}

export type WishlistState = { loggedIn: boolean; productIds: string[] };

/** Called once per page load by WishlistButton(s): who is this visitor and what did they save? */
export async function getWishlistStateAction(): Promise<WishlistState> {
  const c = await getShopCustomer();
  if (!c) return { loggedIn: false, productIds: [] };
  const ids = await wishlistProductIds({ tenantId: c.tenant.id, customerId: c.customer.id });
  return { loggedIn: true, productIds: [...ids] };
}

export type ToggleWishlistResult = { ok: true; inWishlist: boolean } | { ok: false; error: "unauthenticated" | "not_found" | "limit" | "invalid" };

export async function toggleWishlistAction(productId: unknown, on: unknown): Promise<ToggleWishlistResult> {
  if (typeof productId !== "string" || typeof on !== "boolean") return { ok: false, error: "invalid" };
  const c = await getShopCustomer();
  if (!c) return { ok: false, error: "unauthenticated" };
  return toggleWishlist({ tenantId: c.tenant.id, customerId: c.customer.id }, productId, on);
}
