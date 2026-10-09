import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { fieldCopy } from "./_copy-field";

export const fieldCopyDe: CopyShape<typeof fieldCopy> = {
  label: "Artikel suchen",
  placeholder: "Im Shop suchen…",
  catalogPlaceholder: "Titel, Beschreibung oder Nummer suchen",
  submit: "Suchen",
  photo: "Mit Foto suchen",
  open: "Suchen",
  close: "Suche schließen",
};
