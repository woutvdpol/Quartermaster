import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { uiCopy } from "./_copy";

export const uiCopyNl: CopyShape<typeof uiCopy> = {
  price: {
    was: "Was",
    indicative: "indicatief",
    indicativeTitle: "Indicatieve omrekening. U betaalt altijd in de valuta van de shop.",
  },
  product: {
    sold: "Verkocht",
    reserved: "Gereserveerd",
    sale: "Aanbieding",
    locked: "Log in om te bekijken",
    lockedHint: "Dit item is alleen zichtbaar voor ingelogde klanten.",
    noImage: "Nog geen foto",
    priceOnRequest: "Verkocht",
    stockCode: "Nr.",
  },
  breadcrumbs: { label: "Kruimelpad", home: "Home" },
  pagination: { label: "Paginering", previous: "Vorige", next: "Volgende", page: "Pagina", current: "huidige pagina" },
};
