import { localized } from "@/lib/i18n/shop-copy";
import { offerCopyNl } from "./_copy.nl";
import { offerCopyDe } from "./_copy.de";

/**
 * Copy for the offer flow. English source; Dutch and German in _copy.nl.ts / _copy.de.ts (`offerCopies`).
 * `errors` translates the English messages of src/server/offers (see cart/server-messages.ts).
 */
export const offerCopy = {
  button: "Make an offer",
  dialogTitle: "Make an offer",
  intro: (price: string, min: string) => `Listed at ${price}. Offers from ${min} are considered; we usually answer within 72 hours.`,
  name: "Your name",
  email: "Email address",
  amount: "Your offer",
  message: "Message (optional)",
  submit: "Send offer",
  sending: "Sending…",
  cancel: "Cancel",
  close: "Close",
  sent: "Thank you! We received your offer and sent a confirmation to your email.",
  stillForSale: "The item stays for sale until we accept an offer.",
  invalidAmount: "Enter an amount like 85 or 85.50",
  error: "Something went wrong. Please try again.",
  // /offer/<token>
  checkoutTitle: "Your agreed price",
  checkoutMeta: "Your offer",
  agreed: "Agreed price",
  listPrice: "List price",
  validUntil: (d: string) => `This personal price is valid until ${d}.`,
  buyNow: "Buy now",
  buying: "Adding to cart…",
  private: "Keep this link private: anyone with it can buy at your price.",
  expired: "This personal price has expired. Contact us if you are still interested.",
  used: "You already ordered this item with your agreed price.",
  sold: "Sorry — this item is no longer available.",
  closed: "This offer is no longer valid.",
  notFound: "This offer link is not valid. It may have been replaced by a newer link in a later email.",
  viewShop: "Browse the shop",
  // /offer/counter/<token>
  counterTitle: "Our counter offer",
  yourOffer: "Your offer",
  ourProposal: "Our proposal",
  counterValid: (d: string) => `Valid until ${d}.`,
  accept: (amount: string) => `Accept ${amount}`,
  decline: "No thanks",
  declined: "Thanks for letting us know. Your offer has been withdrawn.",
  counterExpired: "This counter offer has expired.",
  counterAccepted: "You already accepted this counter offer — check your email for your personal checkout link.",
  counterClosed: "This counter offer is no longer open.",
  /** Messages returned by the offer service and actions (English originals there). */
  errors: {
    checkFields: "Please check the highlighted fields",
    name: "Enter your name",
    amount: "Enter an amount",
    severalOffers: "You have made several offers recently. Please try again later.",
    notAllowed: "This item doesn't accept offers",
    inSomeonesCart: "Someone has this item in their cart right now. Please try again later.",
    atOrAbovePrice: "Your offer is at or above the price — you can simply buy it",
    lowest: (amount: string) => `The lowest offer we can consider is ${amount}`,
    duplicate: "You already have an open offer for this item. We'll get back to you soon.",
    captcha: "We could not verify that you are human. Please try again.",
    offerLinkInvalid: "This offer link is no longer valid",
    linkInvalid: "This link is no longer valid",
    unknownChoice: "Unknown choice",
    counterAnswered: "This counter offer was already answered",
    counterExpired: "This counter offer has expired",
    soldMeantime: "Sorry — this item has been sold in the meantime",
  },
} as const;

export const offerCopies = localized({ en: offerCopy, nl: offerCopyNl, de: offerCopyDe });
