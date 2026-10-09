"use client";

import { createContext, useContext, type ReactNode } from "react";
import { localizePath, SOURCE_LOCALE, type ShopLocale } from "@/lib/i18n/shop-locales";
import { pickCopy, type Localized } from "@/lib/i18n/shop-copy";

/*
 * Shop language for client components (docs/i18n.md § Shop-routing). Provided once by the shop layout.
 * Switching language is always a full page load (LanguageSwitcher), so the value never changes
 * during a client-side navigation. Outside the provider (platform pages) everything is English.
 */

type ShopLocaleValue = { locale: ShopLocale; locales: readonly ShopLocale[] };

const ShopLocaleContext = createContext<ShopLocaleValue>({ locale: SOURCE_LOCALE, locales: [SOURCE_LOCALE] });

export function ShopLocaleProvider({ locale, locales, children }: ShopLocaleValue & { children: ReactNode }) {
  return <ShopLocaleContext.Provider value={{ locale, locales }}>{children}</ShopLocaleContext.Provider>;
}

/** Current shop language. */
export function useShopLocale(): ShopLocale {
  return useContext(ShopLocaleContext).locale;
}

/** Languages this shop serves (English first). */
export function useShopLocales(): readonly ShopLocale[] {
  return useContext(ShopLocaleContext).locales;
}

/** UI copy in the current language: `const t = useShopCopy(cartCopies)`. */
export function useShopCopy<T>(bundle: Localized<T>): T {
  return pickCopy(bundle, useShopLocale());
}

/** Localises same-site paths for router.push / fetch / form actions: `const href = useLocalizedHref(); href("/cart")`. */
export function useLocalizedHref(): (path: string) => string {
  const locale = useShopLocale();
  return (path: string) => localizePath(path, locale);
}
