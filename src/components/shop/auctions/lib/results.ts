import type { LiveBid, LiveLot } from "./types";

/*
 * Results of the shop's auction server actions (../actions.ts). Pure types + the code list, so client
 * components can map every refusal to their own localized message.
 */

/** Engine refusals (src/server/auctions AuctionErrorCode) plus the shop layer's own. */
export const BID_ERROR_CODES = [
  "LOT_CLOSED",
  "NOT_OPEN_YET",
  "BELOW_MINIMUM",
  "BLOCKED",
  "TERMS_REQUIRED",
  "AGE_RESTRICTED",
  "COUNTRY_RESTRICTED",
  "STAFF_CANNOT_BID",
  "NOT_VERIFIED",
  "LOGIN_REQUIRED",
  "INVALID_AMOUNT",
  "RATE_LIMITED",
  "GENERIC",
] as const;

export type BidErrorCode = (typeof BID_ERROR_CODES)[number];

export type BidFailure = { ok: false; code: BidErrorCode; /** BELOW_MINIMUM: the lowest acceptable maximum (minor units). */ minimum?: number };

/** The viewer's position after a bid / on refresh. */
export type MyPosition = { isLeading: boolean; myMax: number | null; bidderNumber: number | null; termsAccepted: boolean; hasBid: boolean };

export type LotRefresh = { lot: LiveLot | null; history: LiveBid[]; mine: MyPosition | null };

export type BidSuccess = { ok: true } & LotRefresh;

export type BidResult = BidSuccess | BidFailure;

export type TermsResult = { ok: true; bidderNumber: number } | BidFailure;
