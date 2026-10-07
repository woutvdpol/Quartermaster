/** English copy for the shop UI primitives (multi-language later: same shape per locale). */
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
