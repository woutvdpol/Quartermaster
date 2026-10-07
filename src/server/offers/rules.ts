// Pure offer rules (no server-only, no DB) — shared by the offers service, the cart and checkout.

/**
 * Minimum offer as a share of the list price, in basis points (5000 = 50 %). Fixed for now; a
 * per-shop setting can replace it later (catalog.offerMinPercent) without changing callers.
 */
export const OFFER_MIN_RATIO_BP = 5000;
/** A PENDING offer the shop didn't answer expires after this (cron offers.expire). */
export const OFFER_PENDING_TTL_HOURS = 72;
/** Personal checkout link after acceptance. */
export const OFFER_CHECKOUT_TTL_HOURS = 48;
/** A counter offer can be accepted by the customer for this long. */
export const OFFER_COUNTER_TTL_HOURS = 72;

export type OfferStatusName = "PENDING" | "ACCEPTED" | "COUNTERED" | "REJECTED" | "EXPIRED" | "WITHDRAWN" | "CONVERTED";

/** Lowest acceptable offer for a list price (rounded up to the cent). */
export function minimumOffer(listPrice: number): number {
  return Math.ceil((listPrice * OFFER_MIN_RATIO_BP) / 10000);
}

/** Offers are possible when the product allows them or the shop allows them by default. */
export function offersAllowed(product: { acceptsOffers: boolean }, catalog: { allowOffersDefault: boolean }): boolean {
  return product.acceptsOffers || catalog.allowOffersDefault;
}

export type OfferPriceCandidate = {
  tenantId: string;
  productId: string;
  status: string;
  agreedAmount: number | null;
  checkoutExpiresAt: Date | null;
  orderId: string | null;
};

/**
 * Whether a cart line may use the offer's agreed price: same tenant and product, ACCEPTED, link not
 * expired and not used by an order yet. Otherwise the line falls back to the list price (and is
 * shown as such in cart and checkout — what the customer sees is what they pay).
 */
export function offerPriceApplies(offer: OfferPriceCandidate | null | undefined, line: { tenantId: string; productId: string }, now: Date = new Date()): offer is OfferPriceCandidate & { agreedAmount: number } {
  return (
    !!offer &&
    offer.tenantId === line.tenantId &&
    offer.productId === line.productId &&
    offer.status === "ACCEPTED" &&
    typeof offer.agreedAmount === "number" &&
    offer.agreedAmount > 0 &&
    !!offer.checkoutExpiresAt &&
    offer.checkoutExpiresAt.getTime() > now.getTime() &&
    !offer.orderId
  );
}

/** Offer as a percentage of the list price, one decimal (null when the price is 0). */
export function percentOfPrice(amount: number, listPrice: number): number | null {
  if (listPrice <= 0) return null;
  return Math.round((amount / listPrice) * 1000) / 10;
}
