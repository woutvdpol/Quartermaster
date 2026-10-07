import { en, type Dictionary } from "./en";

export type { Dictionary };

/** UI language. English only for now; add dictionaries here (same shape as `en`) to go multilingual. */
export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

const dictionaries: Record<Locale, Dictionary> = { en };

export function getDictionary(locale: Locale = DEFAULT_LOCALE): Dictionary {
  return dictionaries[locale];
}
