/*
 * Client-safe shapes of the auction engine's public DTOs (src/server/auctions: PublicLot, PublicBid).
 * Structural copies so client components never import the server module; the engine's types are
 * assignable to these.
 */

export type LotStatus = "OPEN" | "SOLD" | "UNSOLD" | "CANCELLED";

export type LiveLot = {
  id: string;
  auctionId: string;
  lotNumber: number;
  productId: string;
  stockCode: number;
  title: string;
  slug: string;
  coverKey: string | null;
  /** Minor units. */
  startPrice: number;
  currentBid: number | null;
  nextMinimum: number;
  bidCount: number;
  /** ISO; moves forward with late-bid extensions. */
  closesAt: string;
  extended: boolean;
  status: LotStatus;
  /** null = no reserve (or not disclosed). */
  reserveMet: boolean | null;
  leaderNumber: number | null;
};

export type LiveBid = { bidderNumber: number; amount: number; isAuto: boolean; at: string };

/** The signed-in customer's position on one lot (getMyLotState). */
export type MyLotState = {
  isLeading: boolean;
  myMax: number | null;
  outbid: boolean;
  bidderNumber: number | null;
  termsAccepted: boolean;
};
