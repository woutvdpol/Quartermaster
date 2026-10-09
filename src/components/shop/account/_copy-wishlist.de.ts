import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { wishlistCopy } from "./_copy-wishlist";

export const wishlistCopyDe: CopyShape<typeof wishlistCopy> = {
  title: "Merkliste",
  intro: "Ihre gemerkten Artikel. Jedes Stück ist ein Unikat — einmal verkauft, ist es weg.",
  empty: "Ihre Merkliste ist leer.",
  emptyHint: "Tippen Sie bei einem Artikel auf das Herz, um ihn hier zu speichern.",
  browse: "Zum Shop",
  add: "Auf die Merkliste",
  remove: "Von der Merkliste entfernen",
  saved: "Gemerkt",
  save: "Merken",
  loginToSave: "Melden Sie sich an, um Artikel auf Ihre Merkliste zu setzen",
  available: "Verfügbar",
  reserved: "Reserviert",
  sold: "Verkauft",
  addedOn: "Gemerkt am",
  error: "Ihre Merkliste konnte nicht aktualisiert werden. Bitte versuchen Sie es erneut.",
};
