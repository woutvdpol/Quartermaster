/** Wishlist copy — its own module so the client WishlistButton (on every product card) does not bundle all of accountCopy. */
export const wishlistCopy = {
  title: "Wishlist",
  intro: "Items you saved. Every item is unique — once it is sold, it is gone.",
  empty: "Your wishlist is empty.",
  emptyHint: "Tap the heart on any item to save it here.",
  browse: "Browse the shop",
  add: "Add to wishlist",
  remove: "Remove from wishlist",
  saved: "Saved",
  save: "Save",
  loginToSave: "Log in to save items to your wishlist",
  available: "Available",
  reserved: "Reserved",
  sold: "Sold",
  addedOn: "Saved on",
  error: "Could not update your wishlist. Please try again.",
} as const;
