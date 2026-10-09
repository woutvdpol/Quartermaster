import { INTL_LOCALE, type ShopLocale } from "./shop-locales";

/*
 * Shop UI dictionaries (docs/i18n.md § Shop-routing). Each area keeps its English copy in `_copy.ts`
 * (`as const`) and adds Dutch and German siblings (`_copy.nl.ts`, `_copy.de.ts`) typed as
 * `CopyShape<typeof englishCopy>`, so a missing or extra key is a type error. The area then exports a
 * bundle `{ en, nl, de }` (`Localized<…>`) that components pick from:
 *   - server components / actions:  `await shopCopy(bundle)`        (src/server/i18n/locale.ts)
 *   - client components:            `useShopCopy(bundle)`           (src/components/shop/i18n/ShopLocale.tsx)
 *   - shared (no directive) parts:  `bundle[locale]` with a `locale` prop
 * UI strings are translated by people (here), never by the machine translator.
 */

type Fn = (...args: never[]) => unknown;

/** The shape of an English `as const` copy object with literal strings widened to `string`. */
export type CopyShape<T> = T extends string
  ? string
  : T extends Fn
    ? T extends (...args: infer A) => infer R
      ? (...args: A) => R extends string ? string : CopyShape<R>
      : never
    : T extends readonly (infer U)[]
      ? readonly CopyShape<U>[]
      : T extends object
        ? { readonly [K in keyof T]: CopyShape<T[K]> }
        : T;

/** One copy object per shop language. */
export type Localized<T> = { readonly en: T } & { readonly [L in Exclude<ShopLocale, "en">]: CopyShape<T> };

/** Declares a bundle (type check only; returns its argument). */
export function localized<T>(bundle: { en: T; nl: CopyShape<T>; de: CopyShape<T> }): Localized<T> {
  return bundle as Localized<T>;
}

/** The copy of `locale` (typed as the English object, so call sites keep their literal types). */
export function pickCopy<T>(bundle: Localized<T>, locale: ShopLocale): T {
  return (bundle[locale] ?? bundle.en) as T;
}

// ─── Formatting per language ────────────────────────────────────────────────

const numberFormats = new Map<string, Intl.NumberFormat>();

/** 1450 → "1,450" (en) · "1.450" (nl, de). */
export function formatCount(n: number, locale: ShopLocale): string {
  const key = INTL_LOCALE[locale];
  let f = numberFormats.get(key);
  if (!f) numberFormats.set(key, (f = new Intl.NumberFormat(key)));
  return f.format(n);
}

/** Date in the shop's time zone, e.g. "9 Oct 2026" · "9 okt 2026" · "9. Okt. 2026". Falls back to no time zone if invalid. */
export function formatShopDate(
  d: Date | string,
  locale: ShopLocale,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" },
  timeZone?: string,
): string {
  const date = typeof d === "string" ? new Date(d) : d;
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...options, ...(timeZone ? { timeZone } : {}) }).format(date);
  } catch {
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], options).format(date);
  }
}
