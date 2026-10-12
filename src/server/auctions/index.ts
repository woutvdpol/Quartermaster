// Auctions (docs/auctions.md, docs/auctions-plan.md). Service entry point for the shop and the admin.
// Pure helpers live in ./increments.ts and ./engine.ts (importable from client code); the realtime
// listener (./realtime.ts) is only for the SSE route.
import "server-only";

export * from "./increments";
export {
  applyBid,
  checkBid,
  minimumFor,
  replayBids,
  extendClose,
  scheduledClose,
  reserveMet,
  closesAsSold,
  visibleHistory,
  EMPTY_LOT_STATE,
  type LotState,
  type EngineConfig,
  type BidStep,
  type BidOutcome,
} from "./engine";
export { AUCTION_PATHS } from "./paths";
export { AuctionError, auctionErrorReason, type AuctionErrorCode } from "./shared";
export { auctionErrorCopies, auctionErrorCopy } from "./_copy";

// Shop
export {
  getPublicAuction,
  getPublicAuctionById,
  listPublicAuctions,
  getPublicLot,
  getMyLotState,
  lotForProduct,
  lotHistory,
  loadPublicLots,
  type PublicLot,
  type PublicBid,
  type PublicAuction,
  type AuctionSummary,
} from "./public";
export { acceptAuctionTerms, placeBid, shopCustomerContext, type ShopCustomerContext, type PlaceBidInput, type PlaceBidResult } from "./bidding";
export {
  getAuctionPayView,
  quoteAuctionPayment,
  submitAuctionPayment,
  type AuctionPayView,
  type AuctionPayState,
  type AuctionPaymentInput,
  type SubmitAuctionPaymentResult,
} from "./pay";

// Staff
export {
  createAuction,
  updateAuction,
  publishAuction,
  cancelAuction,
  addLots,
  updateLot,
  removeLot,
  reorderLots,
  getAuctionAdmin,
  listAuctionsAdmin,
  getAuctionResults,
  listLotBidsAdmin,
  voidBid,
  blockBidder,
  unblockBidder,
  listBlockedBidders,
  isBlockedBidder,
  getBidSignals,
  cancelWonLot,
  sendPaymentReminder,
  RESERVED_AUCTION_SLUGS,
  type AuctionInput,
  type AuctionPatch,
  type AuctionAdmin,
  type AdminLotRow,
  type AuctionListItem,
  type AuctionResultRow,
  type AuctionResults,
  type BidSignalRow,
} from "./admin";

// Scheduler (worker / tests)
export { closeLot, tickOnce, runAuctionTicks, reconcileWonLots, PAYMENT_REMINDER_DAYS, type CloseLotResult } from "./closing";
