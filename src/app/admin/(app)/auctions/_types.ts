/*
 * View types the auction admin screens render. `_service.ts` maps the engine's results
 * (src/server/auctions) onto these, so the screens don't depend on the engine's exact shapes.
 */
import type { AuctionLotStatus, AuctionStatus, AuctionType } from "@/generated/prisma/enums";

export type AuctionListRow = {
  id: string;
  title: string;
  type: AuctionType;
  status: AuctionStatus;
  opensAt: Date;
  /** First lot's close (DAY) / the lot's close (SINGLE). */
  firstCloseAt: Date;
  /** Last lot's (current) close, when known. */
  lastCloseAt: Date | null;
  lots: number;
  bids: number;
  /** Sum of the current bids (live) or hammer prices (closed) of lots above reserve. */
  hammerTotal: number;
};

export type AdminLeader = { customerId: string; name: string; email: string; bidderNumber: number | null };

export type AdminLot = {
  id: string;
  lotNumber: number;
  productId: string;
  stockCode: number;
  title: string;
  thumb: string | null;
  listPrice: number;
  startPrice: number;
  reservePrice: number | null;
  currentBid: number | null;
  leadingMax: number | null;
  bidCount: number;
  closesAt: Date;
  extended: boolean;
  status: AuctionLotStatus;
  leader: AdminLeader | null;
};

export type AdminAuction = {
  id: string;
  type: AuctionType;
  status: AuctionStatus;
  title: string;
  slug: string;
  opensAt: Date;
  firstCloseAt: Date;
  gapSeconds: number;
  extendSeconds: number;
  payDays: number;
  increments: { upTo: number | null; step: number }[];
  closedAt: Date | null;
  lots: AdminLot[];
  stats: { bids: number; bidders: number; currentTotal: number; lotsAboveReserve: number };
};

export type BidSignal = {
  customers: { customerId: string; name: string; bidderNumber: number | null }[];
  sharedBy: "device" | "ip";
  lots: { lotId: string; lotNumber: number }[];
  count: number;
  /** True when these bidders mostly bid against each other on those lots. */
  against: boolean;
};

export type ResultRow = {
  lotId: string;
  lotNumber: number;
  productId: string;
  stockCode: number;
  title: string;
  listPrice: number;
  lotStatus: AuctionLotStatus;
  reserveMet: boolean | null;
  hammer: number | null;
  winner: AdminLeader | null;
  orderId: string | null;
  paid: boolean;
  closedAt: Date | null;
  daysSinceClose: number | null;
};

export type AuctionResults = {
  auction: { id: string; title: string; status: AuctionStatus; payDays: number; closedAt: Date | null };
  rows: ResultRow[];
};

export type BlockedBidderRow = { customerId: string; name: string; email: string; reason: string | null; createdAt: Date };
