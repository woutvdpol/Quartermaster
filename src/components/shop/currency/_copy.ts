import { localized } from "@/lib/i18n/shop-copy";
import { currencyCopyNl } from "./_copy.nl";
import { currencyCopyDe } from "./_copy.de";

/** Copy for the header's display-currency switcher. English source; Dutch and German in _copy.nl.ts / _copy.de.ts. */
export const currencyCopy = {
  label: "Show prices also in",
  title: (label: string, currency: string) => `${label} (indicative — you pay in ${currency})`,
} as const;

export const currencyCopies = localized({ en: currencyCopy, nl: currencyCopyNl, de: currencyCopyDe });
