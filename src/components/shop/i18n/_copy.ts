import { localized } from "@/lib/i18n/shop-copy";

/** Copy of the language switcher and the "translated" note (docs/i18n.md § Shop-routing). */
export const i18nCopy = {
  language: "Language",
  translatedFrom: "Translated from English",
  showOriginal: "Show original",
  showTranslation: "Show translation",
  originalNote: "Original English text",
} as const;

export const i18nCopies = localized({
  en: i18nCopy,
  nl: {
    language: "Taal",
    translatedFrom: "Vertaald uit het Engels",
    showOriginal: "Origineel tonen",
    showTranslation: "Vertaling tonen",
    originalNote: "Oorspronkelijke Engelse tekst",
  },
  de: {
    language: "Sprache",
    translatedFrom: "Aus dem Englischen übersetzt",
    showOriginal: "Original anzeigen",
    showTranslation: "Übersetzung anzeigen",
    originalNote: "Englischer Originaltext",
  },
});
