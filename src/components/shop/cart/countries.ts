import { COUNTRIES, countryName, isCountryCode } from "@/server/shipping/countries";
import { INTL_LOCALE, type ShopLocale } from "@/lib/i18n/shop-locales";
import type { CountryOption } from "./CartSummary";

/*
 * Country names in the shop language. Pure (server and client). English keeps the static list of
 * src/server/shipping/countries.ts; Dutch and German come from Intl.DisplayNames (falling back to English).
 */

const displayNames = new Map<ShopLocale, Intl.DisplayNames | null>();

function names(locale: ShopLocale): Intl.DisplayNames | null {
  if (!displayNames.has(locale)) {
    let dn: Intl.DisplayNames | null = null;
    try {
      dn = new Intl.DisplayNames([INTL_LOCALE[locale]], { type: "region", fallback: "none" });
    } catch {
      dn = null;
    }
    displayNames.set(locale, dn);
  }
  return displayNames.get(locale) ?? null;
}

/** "DE" → "Germany" · "Duitsland" · "Deutschland". Unknown codes are returned as given. */
export function localizedCountryName(code: string, locale: ShopLocale): string {
  if (locale === "en" || !isCountryCode(code)) return countryName(code);
  try {
    return names(locale)?.of(code) ?? countryName(code);
  } catch {
    return countryName(code);
  }
}

/** Select options for country codes, named and sorted in the shop language. */
export function countryOptions(codes: readonly string[], locale: ShopLocale): CountryOption[] {
  const intl = INTL_LOCALE[locale];
  return codes.map((c) => ({ code: c, name: localizedCountryName(c, locale) })).sort((a, b) => a.name.localeCompare(b.name, intl));
}

let byEnglishName: Map<string, string> | null = null;

/** An English country name (as stored in service messages / order views) in the shop language. */
export function localizeEnglishCountryName(name: string, locale: ShopLocale): string {
  if (locale === "en") return name;
  byEnglishName ??= new Map(Object.entries(COUNTRIES).map(([code, n]) => [n, code]));
  const code = byEnglishName.get(name);
  return code ? localizedCountryName(code, locale) : name;
}
