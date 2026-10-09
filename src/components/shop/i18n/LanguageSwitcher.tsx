"use client";

import { useId } from "react";
import { usePathname } from "next/navigation";
import { LOCALE_NAMES, localizePath, splitLocalePath, type ShopLocale } from "@/lib/i18n/shop-locales";
import { cn } from "@/components/shop/ui/cn";
import { useShopCopy, useShopLocale, useShopLocales } from "./ShopLocale";
import { i18nCopies } from "./_copy";

/** Same page, other language: "/de/shop?q=helm" → "/nl/shop?q=helm". Exported for tests. */
export function switchLocaleHref(pathname: string, search: string, target: ShopLocale): string {
  return localizePath(splitLocalePath(pathname).path + search, target);
}

/**
 * Header language switcher (design: docs/design/insights-duplicates-i18n/ShopDE.dc.html): globe + a
 * native select listing the shop's languages by their own names. Rendered only when the shop serves
 * more than English. Changing it is a full page load to the same page in the other language, so the
 * root layout (<html lang>) and every server-rendered string switch with it.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const id = useId();
  const locale = useShopLocale();
  const locales = useShopLocales();
  const t = useShopCopy(i18nCopies);
  const pathname = usePathname();
  if (locales.length < 2) return null;
  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-[18px] shrink-0 text-shop-ink-2">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
      </svg>
      <label htmlFor={id} className="sr-only">
        {t.language}
      </label>
      <select
        id={id}
        value={locale}
        onChange={(e) => {
          const target = e.target.value as ShopLocale;
          window.location.assign(switchLocaleHref(pathname, window.location.search, target));
        }}
        className="h-9 cursor-pointer rounded-shop-control border border-shop-line-strong bg-shop-surface px-2.5 text-sm font-medium text-shop-ink transition-colors hover:border-shop-ink"
      >
        {locales.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </span>
  );
}
