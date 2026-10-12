import { localized } from "@/lib/i18n/shop-copy";
import { auctionTermsCopyNl } from "./_copy.terms.nl";
import { auctionTermsCopyDe } from "./_copy.terms.de";

/**
 * Built-in auction terms (placeholder until the shop publishes a CMS page `auction-terms`). Kept apart
 * from ./_copy.ts so the long texts never reach the bid box's client bundle. Only the rules of the
 * auction system — no legal claims beyond the plan (docs/auctions-plan.md § Juridisch).
 */
export const auctionTermsCopy = {
  title: "Auction terms",
  metaDescription: (shop: string) => `The rules for bidding in the online auctions of ${shop}.`,
  placeholder: "Placeholder text. The shop has not published its own auction terms yet; these are the general rules of the auction system. The shop must replace this text with its own, legally checked terms.",
  sections: [
    { title: "Bids are binding", body: "Every bid is a binding offer to buy the lot at the amount you end up paying. A bid cannot be withdrawn." },
    { title: "Automatic bidding", body: "You enter the maximum you are willing to pay. We bid for you, one step at a time, only as far as needed to keep you in the lead, up to your maximum. If two bidders have the same maximum, the one who bid first leads." },
    { title: "Bid steps", body: "Bids go up in fixed steps that depend on the current bid. The next minimum bid is always shown next to the bid box." },
    { title: "Reserve price", body: "A lot can have a hidden reserve price. Below it the lot is not sold. The lot page shows whether the reserve has been met." },
    { title: "Closing and extension", body: "Each lot has its own closing time. A bid in the last minutes before closing extends that lot only, so every bidder has the chance to respond." },
    { title: "No buyer's premium", body: "The hammer price is what you pay, plus shipping." },
    { title: "Payment", body: "The winning bidder receives an email with a personal payment link and pays within the period stated in that email." },
    { title: "Right of withdrawal", body: "An online auction is a distance sale. As a consumer you keep the statutory 14-day right of withdrawal after receiving the item." },
    { title: "Bid history", body: "The bid history of every lot is public. Bidders are shown by a number per auction, never by name." },
    { title: "Who can bid", body: "Bidding needs a customer account with a confirmed email address. Staff cannot bid. Age limits and country restrictions of the shop also apply to bidding." },
  ],
} as const;

export const auctionTermsCopies = localized({ en: auctionTermsCopy, nl: auctionTermsCopyNl, de: auctionTermsCopyDe });
