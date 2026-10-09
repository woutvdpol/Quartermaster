import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { uiCopy } from "./_copy";

export const uiCopyDe: CopyShape<typeof uiCopy> = {
  price: {
    was: "Vorher",
    indicative: "unverbindlich",
    indicativeTitle: "Unverbindliche Umrechnung. Sie bezahlen immer in der Währung des Shops.",
  },
  product: {
    sold: "Verkauft",
    reserved: "Reserviert",
    sale: "Angebot",
    locked: "Zum Ansehen anmelden",
    lockedHint: "Dieser Artikel ist nur für angemeldete Kunden sichtbar.",
    noImage: "Noch kein Foto",
    priceOnRequest: "Verkauft",
    stockCode: "Nr.",
  },
  breadcrumbs: { label: "Brotkrumennavigation", home: "Start" },
  pagination: { label: "Seitennavigation", previous: "Zurück", next: "Weiter", page: "Seite", current: "aktuelle Seite" },
};
