// Routes of the auction flow (pure). Keep in sync with src/app/(shop)/auctions/** and src/app/admin/(app)/auctions/**.

export const AUCTION_PATHS = {
  /** Shop: overview (live, upcoming, single lots). */
  catalogue: "/auctions",
  /** Shop: one auction (catalogue of lots). */
  auction: (slug: string) => `/auctions/${encodeURIComponent(slug)}`,
  /** Shop: one lot (bid box, history). */
  lot: (lotId: string) => `/auctions/lot/${encodeURIComponent(lotId)}`,
  /** Shop: the winner's personal payment page (choose delivery, pay). */
  pay: (token: string) => `/auctions/pay/${encodeURIComponent(token)}`,
  /** Realtime + polling endpoints. */
  stream: (auctionId: string) => `/api/auctions/${encodeURIComponent(auctionId)}/stream`,
  lots: (auctionId: string) => `/api/auctions/${encodeURIComponent(auctionId)}/lots`,
  /** Admin. */
  admin: (auctionId: string) => `/admin/auctions/${encodeURIComponent(auctionId)}`,
} as const;
