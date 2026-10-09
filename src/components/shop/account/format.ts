import { countryName } from "@/server/shipping/countries";
import { formatShopDate } from "@/lib/i18n/shop-copy";
import { INTL_LOCALE, type ShopLocale } from "@/lib/i18n/shop-locales";

/** "7 Oct 2026" · "7 okt 2026" · "7. Okt. 2026" in the shop's timezone. */
export function formatDate(d: Date, timeZone: string, locale: ShopLocale): string {
  return formatShopDate(d, locale, { day: "numeric", month: "short", year: "numeric" }, timeZone);
}

const regionNames = new Map<ShopLocale, Intl.DisplayNames | null>();

/** Country name in the shop language ("DE" → "Germany" · "Duitsland" · "Deutschland"); English list as fallback. */
export function localCountryName(code: string, locale: ShopLocale): string {
  if (!regionNames.has(locale)) {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames(INTL_LOCALE[locale], { type: "region" });
    } catch {
      names = null;
    }
    regionNames.set(locale, names);
  }
  const names = regionNames.get(locale);
  if (locale === "en" || !names) return countryName(code);
  try {
    const name = names.of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? name : countryName(code);
  } catch {
    return countryName(code);
  }
}

export { countryName };
