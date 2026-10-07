// Plain data for the commerce mails (offers, abandoned cart). No server imports.

export type OfferMailData = {
  productTitle: string;
  /** Absolute product page URL. */
  productUrl: string;
  /** Absolute thumbnail URL, or null (no image / sensitive item). */
  imageUrl: string | null;
  stockCode: number;
  currency: string;
  listPrice: number;
  /** The customer's offer. */
  amount: number;
  counterAmount: number | null;
  agreedAmount: number | null;
  customerName: string;
  email: string;
  message: string | null;
  responseNote: string | null;
};

export type CartMailLine = {
  title: string;
  /** Absolute URLs. */
  url: string;
  imageUrl: string | null;
  price: number;
  /** Still for sale (not sold / unpublished). */
  available: boolean;
};
