import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { wishlistCopy } from "./_copy-wishlist";

export const wishlistCopyNl: CopyShape<typeof wishlistCopy> = {
  title: "Verlanglijst",
  intro: "Items die u heeft bewaard. Elk stuk is uniek — verkocht is weg.",
  empty: "Uw verlanglijst is leeg.",
  emptyHint: "Tik op het hartje bij een item om het hier te bewaren.",
  browse: "Bekijk de shop",
  add: "Op verlanglijst zetten",
  remove: "Van verlanglijst verwijderen",
  saved: "Bewaard",
  save: "Bewaren",
  loginToSave: "Log in om items op uw verlanglijst te zetten",
  available: "Beschikbaar",
  reserved: "Gereserveerd",
  sold: "Verkocht",
  addedOn: "Bewaard op",
  error: "Uw verlanglijst kon niet worden bijgewerkt. Probeer het opnieuw.",
};
