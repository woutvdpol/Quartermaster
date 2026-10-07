import type { Metadata } from "next";
import { Container } from "@/components/shop/ui/Container";
import { ButtonLink } from "@/components/shop/ui/Button";
import { EmptyState } from "@/components/shop/ui/EmptyState";
import { formatMoney } from "@/components/shop/ui/money";
import { CounterButtons } from "@/components/shop/offers/OfferActionButtons";
import { OfferProductCard, formatShopDate } from "@/components/shop/offers/OfferProductCard";
import { offerCopy as t } from "@/components/shop/offers/_copy";
import { requireShop } from "@/server/storefront/context";
import { getShopViewer } from "@/server/cart";
import { getCounterView } from "@/server/offers";

export const metadata: Metadata = { title: t.counterTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Counter offer: accept / decline (POST buttons; the GET page never changes anything). */
export default async function CounterOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shop = await requireShop();
  const [view, viewer] = await Promise.all([getCounterView(shop.tenant.id, token), getShopViewer(shop.tenant.id)]);
  if (!view) {
    return (
      <Container size="narrow" className="py-12">
        <EmptyState title={t.counterTitle} action={<ButtonLink href="/shop" variant="primary">{t.viewShop}</ButtonLink>}>
          {t.notFound}
        </EmptyState>
      </Container>
    );
  }
  const fmt = (n: number) => formatMoney(n, view.currency);
  const showImage = !(view.product.blurred && !viewer && shop.settings.legal.blurSensitiveForGuests);
  return (
    <Container size="narrow" className="py-8 sm:py-12">
      <h1 className="mb-6 text-3xl sm:text-4xl">{t.counterTitle}</h1>
      <OfferProductCard product={view.product} showImage={showImage}>
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-shop-ink-2">{t.listPrice}</dt>
            <dd className="tabular-nums">{fmt(view.product.listPrice)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-shop-ink-2">{t.yourOffer}</dt>
            <dd className="tabular-nums">{fmt(view.amount)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-shop-line pt-2">
            <dt className="font-medium">{t.ourProposal}</dt>
            <dd className="font-shop-heading text-2xl font-semibold tabular-nums">{fmt(view.counterAmount)}</dd>
          </div>
        </dl>
        {view.note ? <p className="whitespace-pre-line rounded-shop-sm bg-shop-sunken px-3 py-2 text-sm">{view.note}</p> : null}
        {view.state === "open" ? (
          <>
            {view.expiresAt ? <p className="text-sm text-shop-ink-2">{t.counterValid(formatShopDate(view.expiresAt, shop.tenant.timezone))}</p> : null}
            {view.product.available ? <CounterButtons token={token} acceptLabel={t.accept(fmt(view.counterAmount))} /> : <p className="text-sm text-shop-crit">{t.sold}</p>}
          </>
        ) : (
          <p role="status" className="rounded-shop-sm bg-shop-warn-soft px-3 py-2 text-sm text-shop-warn">
            {view.state === "expired" ? t.counterExpired : view.state === "accepted" ? t.counterAccepted : t.counterClosed}
          </p>
        )}
      </OfferProductCard>
    </Container>
  );
}
