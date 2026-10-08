import "server-only";
import { calculateShippingQuote, type QuoteInput, type QuoteResult } from "@/server/shipping/calc";
import { loadQuoteZones } from "@/server/shipping/quote";
import { shopCache } from "./cache";

/**
 * Active shipping zones + rates for storefront *estimates* (product page "Shipping to … from …").
 * Identical for every visitor, so it lives in the data cache (area `settings`); every shipping.*
 * mutation is audited and revalidates the whole tenant tag (src/server/storefront/cache.ts).
 * Checkout totals and order placement never use this — they read the zones live.
 */
const cachedQuoteZones = shopCache("quote-zones", "settings", loadQuoteZones);

/** Shipping estimate from cached zones. Inputs are server values (no validation layer). */
export async function estimateShopShipping(tenantId: string, input: QuoteInput): Promise<QuoteResult> {
  return calculateShippingQuote(await cachedQuoteZones(tenantId), input);
}

/** Active zones + rates from the data cache (structured data: OfferShippingDetails, return countries). */
export function getShopQuoteZones(tenantId: string) {
  return cachedQuoteZones(tenantId);
}
