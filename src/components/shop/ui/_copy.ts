import { localized } from "@/lib/i18n/shop-copy";
import { uiCopyDe } from "./_copy.de";
import { uiCopyNl } from "./_copy.nl";

/** English copy for the shop UI primitives (Dutch/German: ./_copy.nl.ts, ./_copy.de.ts). */
export const uiCopy = {
  price: {
    was: "Was",
    indicative: "indicative",
    indicativeTitle: "Indicative conversion. You always pay in the shop currency.",
  },
  product: {
    sold: "Sold",
    reserved: "Reserved",
    sale: "Sale",
    locked: "Log in to view",
    lockedHint: "This item is only visible to signed-in customers.",
    noImage: "No photo yet",
    priceOnRequest: "Sold",
    stockCode: "No.",
  },
  breadcrumbs: { label: "Breadcrumb", home: "Home" },
  pagination: { label: "Pagination", previous: "Previous", next: "Next", page: "Page", current: "current page" },
} as const;

export const uiCopies = localized({ en: uiCopy, nl: uiCopyNl, de: uiCopyDe });
