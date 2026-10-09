import { localeRedirect } from "@/server/i18n/locale";

/** Alias: the wishlist lives at /wishlist (the header links here). */
export default async function AccountWishlistAlias(): Promise<never> {
  return localeRedirect("/wishlist");
}
