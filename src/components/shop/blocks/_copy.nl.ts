import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { blocksCopy } from "./_copy";

export const blocksCopyNl: CopyShape<typeof blocksCopy> = {
  carouselLabel: "Afbeeldingencarrousel",
  galleryLabel: "Galerij",
  testimonialsLabel: "Klantervaringen",
  newItemsTitle: "Nieuw binnen",
  newItemsEmpty: "Er zijn nieuwe items onderweg. Kom binnenkort terug.",
  viewProduct: "Bekijk item",
  items: (n: number) => (n === 1 ? "1 item" : `${n} items`),
  categoriesLabel: "Categorieën",
  slide: (i: number, n: number) => `${i} van ${n}`,
};
