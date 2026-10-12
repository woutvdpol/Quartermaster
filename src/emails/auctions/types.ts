// Plain data for the auction mails. No server imports.

export type AuctionLotMailData = {
  productTitle: string;
  /** Absolute lot page URL. */
  lotUrl: string;
  /** Absolute thumbnail URL, or null (no image / sensitive item). */
  imageUrl: string | null;
  lotNumber: number;
  auctionTitle: string;
  currency: string;
  /** Current bid (outbid mail) or hammer price (won / reminder), minor units. */
  amount: number;
  customerName: string;
  email: string;
  /** Won / reminder: pay before this date. */
  payBy: Date | null;
  timeZone: string;
};
