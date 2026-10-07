export const blocksCopy = {
  carouselLabel: "Image carousel",
  galleryLabel: "Gallery",
  testimonialsLabel: "Testimonials",
  newItemsEmpty: "New items are on their way. Check back soon.",
  viewProduct: "View item",
  items: (n: number) => (n === 1 ? "1 item" : `${n} items`),
  categoriesLabel: "Categories",
  slide: (i: number, n: number) => `${i} of ${n}`,
} as const;
