import type { Metadata } from "next";
import { Container } from "@/components/shop/ui/Container";
import { ButtonLink } from "@/components/shop/ui/Button";
import { EmptyState } from "@/components/shop/ui/EmptyState";
import { formatMoney } from "@/components/shop/ui/money";
import { BuyOfferButton } from "@/components/shop/offers/OfferActionButtons";
import { OfferProductCard, formatShopDate } from "@/components/shop/offers/OfferProductCard";
import { offerCopy as t } from "@/components/shop/offers/_copy";
import { requireShop } from "@/server/storefront/context";
import { getShopViewer } from "@/server/cart";
import { getOfferCheckoutView } from "@/server/offers";

export const metadata: Metadata = { title: t.checkoutTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Personal checkout link of an accepted offer. Read-only; "Buy now" is a POST (server action). */
export default async function OfferCheckoutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shop = await requireShop();
  const [view, viewer] = await Promise.all([getOfferCheckoutView(shop.tenant.id, token), getShopViewer(shop.tenant.id)]);

  if (!view) {
    return (
      <Container size="narrow" className="py-12">
        <EmptyState title={t.checkoutTitle} action={<ButtonLink href="/shop" variant="primary">{t.viewShop}</ButtonLink>}>
          {t.notFound}
        </EmptyState>
      </Container>
    );
  }
  const fmt = (n: number) => formatMoney(n, view.currency);
  const showImage = !(view.product.blurred && !viewer && shop.settings.legal.blurSensitiveForGuests);
  const notice = { ready: null, expired: t.expired, used: t.used, sold: t.sold, closed: t.closed }[view.state];

  return (
    <Container size="narrow" className="py-8 sm:py-12">
      <h1 className="mb-6 text-3xl sm:text-4xl">{t.checkoutTitle}</h1>
      <OfferProductCard product={view.product} showImage={showImage}>
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-shop-ink-2">{t.listPrice}</dt>
            <dd className="tabular-nums text-shop-muted line-through">{fmt(view.product.listPrice)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-medium">{t.agreed}</dt>
            <dd className="font-shop-heading text-2xl font-semibold tabular-nums">{fmt(view.agreedAmount)}</dd>
          </div>
        </dl>
        {view.state === "ready" ? (
          <>
            {view.expiresAt ? <p className="text-sm text-shop-ink-2">{t.validUntil(formatShopDate(view.expiresAt, shop.tenant.timezone))}</p> : null}
            <BuyOfferButton token={token} label={`${t.buyNow} — ${fmt(view.agreedAmount)}`} />
            <p className="text-xs text-shop-muted">{t.private}</p>
          </>
        ) : (
          <p role="status" className="rounded-shop-sm bg-shop-warn-soft px-3 py-2 text-sm text-shop-warn">{notice}</p>
        )}
      </OfferProductCard>
    </Container>
  );
}
