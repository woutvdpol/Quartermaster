import { localized } from "@/lib/i18n/shop-copy";
import { auctionErrorCopyNl } from "./_copy.nl";
import { auctionErrorCopyDe } from "./_copy.de";

/**
 * Shop messages for refused bids (AuctionError.reason → text). English source; Dutch and German in
 * _copy.nl.ts / _copy.de.ts. Pure (no server-only): the bid box may import it too.
 */
export const auctionErrorCopy = {
  LOT_CLOSED: "Bidding on this lot has closed.",
  NOT_OPEN_YET: "Bidding hasn't opened yet.",
  BELOW_MINIMUM: (minimum: string) => `Your maximum must be at least ${minimum}.`,
  BLOCKED: "You can't bid in this shop's auctions. Please contact us if you think this is a mistake.",
  TERMS_REQUIRED: "Please accept the auction terms before your first bid.",
  AGE_RESTRICTED: (age: number) => `Please confirm you are at least ${age} years old.`,
  COUNTRY_RESTRICTED: "This lot can't be sold to your country (local regulations).",
  STAFF_CANNOT_BID: "Staff of this shop can't bid in its auctions.",
  NOT_VERIFIED: "Please confirm your e-mail address before bidding. We sent you a link.",
  RATE_LIMITED: "You are bidding very fast. Please wait a moment.",
  generic: "Your bid couldn't be placed. Please try again.",
} as const;

export const auctionErrorCopies = localized({ en: auctionErrorCopy, nl: auctionErrorCopyNl, de: auctionErrorCopyDe });
