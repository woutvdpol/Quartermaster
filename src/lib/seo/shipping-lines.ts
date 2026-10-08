import { formatMoney } from "@/components/shop/ui/money";
import { findTier, type QuoteZone } from "@/server/shipping/calc";

/**
 * Human-readable shipping facts for one item (markdown alternate / llms): one line per active zone,
 * e.g. "Shipping to Europe: €14.50", "Pickup in store: free". Zones that cannot ship the weight are
 * left out. Pure.
 */
export function shippingLines(
  zones: readonly QuoteZone[],
  input: { weightGrams: number; price: number; freeShippingThreshold: number; currency: string },
): string[] {
  const free = input.freeShippingThreshold > 0 && input.price >= input.freeShippingThreshold;
  const money = (minor: number) => (minor === 0 ? "free" : formatMoney(minor, input.currency));
  return [...zones]
    .filter((z) => z.isActive)
    .sort((a, b) => Number(a.isPickup) - Number(b.isPickup) || a.sortOrder - b.sortOrder)
    .flatMap((z) => {
      if (z.isPickup) {
        const first = [...z.rates].sort((a, b) => a.maxWeightGrams - b.maxWeightGrams)[0];
        return [`Pickup (${z.name}): ${money(first?.price ?? 0)}`];
      }
      const tier = findTier(z.rates, Math.ceil(input.weightGrams));
      return tier ? [`Shipping to ${z.name}: ${money(free ? 0 : tier.price)}`] : [];
    });
}
