import { localized } from "@/lib/i18n/shop-copy";
import { blocksCopyNl } from "./_copy.nl";
import { blocksCopyDe } from "./_copy.de";

export const blocksCopy = {
  carouselLabel: "Image carousel",
  galleryLabel: "Gallery",
  testimonialsLabel: "Testimonials",
  newItemsTitle: "New arrivals",
  newItemsEmpty: "New items are on their way. Check back soon.",
  viewProduct: "View item",
  items: (n: number) => (n === 1 ? "1 item" : `${n} items`),
  categoriesLabel: "Categories",
  slide: (i: number, n: number) => `${i} of ${n}`,
} as const;

export const blocksCopies = localized({ en: blocksCopy, nl: blocksCopyNl, de: blocksCopyDe });
