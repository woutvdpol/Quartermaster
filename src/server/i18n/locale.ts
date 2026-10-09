import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect, permanentRedirect } from "next/navigation";
import { LOCALE_HEADER, localizePath, parseLocaleHeader, type ShopLocale } from "@/lib/i18n/shop-locales";
import { pickCopy, type Localized } from "@/lib/i18n/shop-copy";

/*
 * The language of the current shop request (docs/i18n.md § Shop-routing). src/proxy.ts rewrites
 * "/de/x" → "/x" and sets LOCALE_HEADER; everything else is English. Whether the shop actually
 * serves that language is checked by the shop layout / requireShop (ShopContext.locales).
 * Works in server components, server actions and route handlers.
 */

/** "en" | "nl" | "de" for this request (memoised per request). */
export const getRequestLocale = cache(async (): Promise<ShopLocale> => parseLocaleHeader((await headers()).get(LOCALE_HEADER)));

/** The shop UI copy of the request language: `const t = await shopCopy(cartCopies)`. */
export async function shopCopy<T>(bundle: Localized<T>): Promise<T> {
  return pickCopy(bundle, await getRequestLocale());
}

/** A shop path in the request language ("/cart" → "/de/cart"). */
export async function localeHref(path: string): Promise<string> {
  return localizePath(path, await getRequestLocale());
}

/** `redirect()` to a shop path in the request language. */
export async function localeRedirect(path: string, type?: Parameters<typeof redirect>[1]): Promise<never> {
  return redirect(await localeHref(path), type);
}

/** `permanentRedirect()` (308) to a shop path in the request language. */
export async function localePermanentRedirect(path: string): Promise<never> {
  return permanentRedirect(await localeHref(path));
}
