import { localized } from "@/lib/i18n/shop-copy";
import { fieldCopyDe } from "./_copy-field.de";
import { fieldCopyNl } from "./_copy-field.nl";

/** English copy of the search field shell (kept apart from ./_copy.ts so the page bundle only carries these strings; Dutch/German: ./_copy-field.nl.ts, ./_copy-field.de.ts). */
export const fieldCopy = {
  label: "Search products",
  placeholder: "Search the shop…",
  catalogPlaceholder: "Search title, description or number",
  submit: "Search",
  photo: "Search by photo",
  open: "Search",
  close: "Close search",
} as const;

export const fieldCopies = localized({ en: fieldCopy, nl: fieldCopyNl, de: fieldCopyDe });
