import { headers } from "next/headers";
import { formatMoney } from "@/components/shop/ui";
import { estimateShopShipping } from "@/server/storefront/shipping";
import { countryName } from "@/server/shipping/countries";
import { visitorCountry } from "@/server/storefront-catalog/country";
import { catalogCopy as copy } from "../_copy";

/**
 * "Shipping to Netherlands from €12.50" for the visitor's country (cf-ipcountry → Accept-Language →
 * shop country). Per request (reads headers), so render it inside <Suspense>. Quietly renders nothing
 * when the quote fails.
 */
export async function ShippingHint({
  tenantId,
  currency,
  weightGrams,
  price,
  shopCountry,
  freeShippingThreshold,
}: {
  tenantId: string;
  currency: string;
  weightGrams: number;
  price: number;
  shopCountry: string;
  freeShippingThreshold: number;
}) {
  const h = await headers();
  const country = visitorCountry({ cfIpCountry: h.get("cf-ipcountry"), acceptLanguage: h.get("accept-language") }, shopCountry || "NL");
  // Zones come from the data cache (identical for every visitor); only the country is per request.
  const quote = await estimateShopShipping(tenantId, {
    countryCode: country,
    totalWeightGrams: weightGrams,
    subtotal: price,
    freeShippingThreshold: freeShippingThreshold || null,
  }).catch(() => null);
  if (!quote) return null;
  const name = countryName(country);
  let text: string;
  if (!quote.deliverable) text = copy.product.shippingNone(name);
  else {
    const delivery = quote.options.filter((o) => !o.isPickup).sort((a, b) => a.price - b.price)[0];
    if (!delivery) text = copy.product.shippingPickupOnly(name);
    else if (delivery.price === 0) text = copy.product.shippingFree(name);
    else text = copy.product.shippingFrom(name, formatMoney(delivery.price, currency));
  }
  return (
    <p className="flex items-center gap-2 text-sm text-shop-muted">
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2.5 5.5h9v7h-9zM11.5 8h3.5l2.5 2.5v2h-6M5.5 15a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM14.5 15a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" strokeLinejoin="round" />
      </svg>
      {text}
    </p>
  );
}
