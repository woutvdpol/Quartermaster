import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { parseInput } from "@/server/catalog/errors";
import { calculateShippingQuote, type QuoteResult, type QuoteZone } from "./calc";
import { MAX_PRICE } from "./validation";

export type { QuoteResult, ShippingOption, DeliveryUnavailableReason } from "./calc";

const quoteInputSchema = z.object({
  countryCode: z.string().trim().min(1).max(8),
  totalWeightGrams: z.number().min(0).max(100_000_000),
  subtotal: z.int().min(0).max(MAX_PRICE * 100),
  blockedCountries: z.array(z.string().trim().max(8)).max(300).optional(),
  freeShippingThreshold: z.int().min(0).max(MAX_PRICE * 100).nullish(),
});

export type QuoteShippingInput = z.input<typeof quoteInputSchema>;

/** Active zones of a tenant in the shape the pure calculator needs. */
export async function loadQuoteZones(tenantId: string): Promise<QuoteZone[]> {
  return db.shippingZone.findMany({
    where: { tenantId, isActive: true },
    select: {
      id: true,
      name: true,
      countries: true,
      isPickup: true,
      isActive: true,
      sortOrder: true,
      rates: { select: { maxWeightGrams: true, price: true, insurancePrice: true, maxInsuredValue: true }, orderBy: { maxWeightGrams: "asc" } },
    },
  });
}

/**
 * Shipping options for a cart (storefront/checkout; no staff context — tenant comes from the request host).
 * Prices are minor units in the tenant currency. Re-run at order placement: never trust a client quote.
 *
 * `blockedCountries`: hook for product/category export blocks (caller collects them from the cart).
 * `freeShippingThreshold`: not stored anywhere yet — proposed settings key `checkout.freeShippingThresholdCents`;
 * until it exists the caller passes it (or omits it = no free shipping).
 */
export async function quoteShipping(tenantId: string, input: QuoteShippingInput): Promise<QuoteResult> {
  const data = parseInput(quoteInputSchema, input);
  const zones = await loadQuoteZones(tenantId);
  return calculateShippingQuote(zones, data);
}
