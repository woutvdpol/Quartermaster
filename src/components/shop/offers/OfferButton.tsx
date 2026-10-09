import { getRequestTenant } from "@/server/tenant";
import { getShopViewer } from "@/server/cart";
import { getOfferEligibility } from "@/server/offers";
import { formatMoney } from "@/components/shop/ui/money";
import { getRequestLocale } from "@/server/i18n/locale";
import { OfferDialog } from "./OfferDialog";

/**
 * "Make an offer" for the product page. Server component: renders nothing unless the product accepts
 * offers (product.acceptsOffers or catalog.allowOffersDefault) and is for sale. Per-visitor (viewer
 * prefill) → mount it inside <Suspense fallback={null}>.
 *
 *   <Suspense fallback={null}><OfferButton productId={product.id} /></Suspense>
 */
export async function OfferButton({ productId }: { productId: string }) {
  const tenant = await getRequestTenant();
  if (!tenant) return null;
  const [eligibility, viewer, locale] = await Promise.all([getOfferEligibility(tenant.id, productId), getShopViewer(tenant.id), getRequestLocale()]);
  if (!eligibility) return null;
  return (
    <OfferDialog
      productId={productId}
      priceLabel={formatMoney(eligibility.price, eligibility.currency, locale)}
      minimumLabel={formatMoney(eligibility.minimum, eligibility.currency, locale)}
      currency={eligibility.currency}
      viewer={viewer ? { name: viewer.name, email: viewer.email } : null}
    />
  );
}
