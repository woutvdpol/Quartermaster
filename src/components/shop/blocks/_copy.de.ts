import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { blocksCopy } from "./_copy";

export const blocksCopyDe: CopyShape<typeof blocksCopy> = {
  carouselLabel: "Bilderkarussell",
  galleryLabel: "Galerie",
  testimonialsLabel: "Kundenstimmen",
  newItemsTitle: "Neuzugänge",
  newItemsEmpty: "Neue Artikel sind unterwegs. Schauen Sie bald wieder vorbei.",
  viewProduct: "Artikel ansehen",
  items: (n: number) => (n === 1 ? "1 Artikel" : `${n} Artikel`),
  categoriesLabel: "Kategorien",
  slide: (i: number, n: number) => `${i} von ${n}`,
};
