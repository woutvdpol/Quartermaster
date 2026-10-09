import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { fieldCopy } from "./_copy-field";

export const fieldCopyNl: CopyShape<typeof fieldCopy> = {
  label: "Producten zoeken",
  placeholder: "Zoek in de shop…",
  catalogPlaceholder: "Zoek op titel, beschrijving of nummer",
  submit: "Zoeken",
  photo: "Zoeken met foto",
  open: "Zoeken",
  close: "Zoeken sluiten",
};
