import Link from "@/components/shop/ui/Link";
import { pickCopy } from "@/lib/i18n/shop-copy";
import type { ShopLocale } from "@/lib/i18n/shop-locales";
import { i18nCopies } from "./_copy";

/** Query param that shows the English original of a translated page (noindex variant). */
export const ORIGINAL_PARAM = "original";

/** `?original=1` → true. */
export function wantsOriginal(value: string | string[] | undefined): boolean {
  return (Array.isArray(value) ? value[0] : value) === "1";
}

/**
 * "Translated from English · Show original" under a machine-translated (and approved) description,
 * or "Original English text · Show translation" on the `?original=1` variant (design: ShopDE board).
 * `path` is the page's unprefixed path; the shop Link adds the language.
 */
export function TranslatedNote({ locale, path, original }: { locale: ShopLocale; path: string; original: boolean }) {
  const t = pickCopy(i18nCopies, locale);
  return (
    <p className="flex flex-wrap gap-x-2.5 gap-y-1.5 text-[0.82rem] text-shop-muted">
      <span>{original ? t.originalNote : t.translatedFrom}</span>
      <span aria-hidden="true">·</span>
      <Link
        href={original ? path : `${path}?${ORIGINAL_PARAM}=1`}
        rel={original ? undefined : "nofollow"}
        scroll={false}
        className="underline underline-offset-4 hover:text-shop-ink"
      >
        {original ? t.showTranslation : t.showOriginal}
      </Link>
    </p>
  );
}
