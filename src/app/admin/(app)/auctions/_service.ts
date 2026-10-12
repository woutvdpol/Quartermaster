import "server-only";
import * as engine from "@/server/auctions";
import type { ServiceContext } from "@/server/context";
import { hostToBaseUrl } from "@/server/mail/urls";
import type { AdminAuction, AuctionListRow, AuctionResults, BidSignal, BlockedBidderRow } from "./_types";

/*
 * Thin adapter between the auction engine's staff service (src/server/auctions, admin.ts) and the
 * admin screens: maps the engine's results onto the view types in ./_types.ts, so a change in the
 * engine's shapes only touches this file.
 */

export {
  createAuction,
  updateAuction,
  publishAuction,
  cancelAuction,
  addLots,
  updateLot,
  removeLot,
  reorderLots,
  voidBid,
  blockBidder,
  unblockBidder,
  cancelWonLot,
  sendPaymentReminder,
} from "@/server/auctions";

export async function listAuctionsAdmin(ctx: ServiceContext): Promise<AuctionListRow[]> {
  const rows = await engine.listAuctionsAdmin(ctx);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    status: r.status,
    opensAt: r.opensAt,
    firstCloseAt: r.firstCloseAt,
    lastCloseAt: r.lastCloseAt,
    lots: r.lots,
    bids: r.bids,
    hammerTotal: r.hammerTotal,
  }));
}

export async function getAuctionAdmin(ctx: ServiceContext, id: string): Promise<AdminAuction> {
  const a = await engine.getAuctionAdmin(ctx, id);
  return {
    id: a.id,
    type: a.type,
    status: a.status,
    title: a.title,
    slug: a.slug,
    opensAt: a.opensAt,
    firstCloseAt: a.firstCloseAt,
    gapSeconds: a.gapSeconds,
    extendSeconds: a.extendSeconds,
    payDays: a.payDays,
    increments: a.incrementTable.map((b) => ({ upTo: b.upTo, step: b.step })),
    closedAt: a.closedAt,
    stats: a.stats,
    lots: a.lots.map((l) => ({
      id: l.id,
      lotNumber: l.lotNumber,
      productId: l.productId,
      stockCode: l.stockCode,
      title: l.title,
      thumb: l.thumb,
      listPrice: l.listPrice,
      startPrice: l.startPrice,
      reservePrice: l.reservePrice,
      currentBid: l.currentBid,
      leadingMax: l.leadingMax,
      bidCount: l.bidCount,
      closesAt: l.closesAt,
      extended: l.extended,
      status: l.status,
      leader: l.leader,
    })),
  };
}

export async function getAuctionResults(ctx: ServiceContext, id: string): Promise<AuctionResults> {
  const r = await engine.getAuctionResults(ctx, id);
  return {
    auction: { id: r.auction.id, title: r.auction.title, status: r.auction.status, payDays: r.auction.payDays, closedAt: r.auction.closedAt },
    rows: r.rows.map((x) => ({
      lotId: x.lot.id,
      lotNumber: x.lot.lotNumber,
      productId: x.product.id,
      stockCode: x.product.stockCode,
      title: x.product.title,
      listPrice: x.product.listPrice,
      lotStatus: x.lot.status,
      // UNSOLD with bids = reserve not met; UNSOLD without bids = no bids.
      reserveMet: x.lot.status === "UNSOLD" ? (x.lot.bidCount > 0 ? false : null) : x.lot.status === "SOLD" ? true : null,
      hammer: x.hammer,
      winner: x.winner,
      orderId: x.order?.id ?? null,
      paid: !!x.order?.paid,
      closedAt: x.lot.closedAt,
      daysSinceClose: x.daysSinceClose,
    })),
  };
}

export async function getBidSignals(ctx: ServiceContext, id: string): Promise<BidSignal[]> {
  const rows = await engine.getBidSignals(ctx, id);
  return rows
    .filter((r) => r.customers.some((c) => !c.blocked))
    .map((r) => ({
      customers: r.customers.map((c) => ({ customerId: c.customerId, name: c.name, bidderNumber: c.bidderNumber })),
      sharedBy: r.sharedBy,
      lots: r.lots,
      count: r.count,
      against: false,
    }));
}

export async function listBlockedBidders(ctx: ServiceContext): Promise<BlockedBidderRow[]> {
  const rows = await engine.listBlockedBidders(ctx);
  return rows.map((r) => ({ customerId: r.customerId, name: r.name, email: r.email, reason: r.reason, createdAt: r.createdAt }));
}

/** Public auction page in the shop. */
export function shopAuctionUrl(host: string, slug: string): string {
  return `${hostToBaseUrl(host)}${engine.AUCTION_PATHS.auction(slug)}`;
}

/** Public auction terms page in the shop. */
export function shopTermsUrl(host: string): string {
  return `${hostToBaseUrl(host)}${engine.AUCTION_PATHS.catalogue}/terms`;
}
