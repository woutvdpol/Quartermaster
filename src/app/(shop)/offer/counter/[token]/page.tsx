import type { Metadata } from "next";
import { Container } from "@/components/shop/ui/Container";
import { ButtonLink } from "@/components/shop/ui/Button";
import { EmptyState } from "@/components/shop/ui/EmptyState";
import { formatMoney } from "@/components/shop/ui/money";
import { CounterButtons } from "@/components/shop/offers/OfferActionButtons";
import { OfferProductCard, formatOfferDate } from "@/components/shop/offers/OfferProductCard";
import { offerCopies } from "@/components/shop/offers/_copy";
import { pickCopy } from "@/lib/i18n/shop-copy";
import { shopCopy } from "@/server/i18n/locale";
import { requireShop } from "@/server/storefront/context";
import { getShopViewer } from "@/server/cart";
import { getCounterView } from "@/server/offers";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopCopy(offerCopies);
  return { title: t.counterTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** Counter offer: accept / decline (POST buttons; the GET page never changes anything). */
export default async function CounterOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shop = await requireShop();
  const locale = shop.locale;
  const t = pickCopy(offerCopies, locale);
  const [view, viewer] = await Promise.all([getCounterView(shop.tenant.id, token), getShopViewer(shop.tenant.id)]);
  if (!view) {
    return (
      <Container size="narrow" className="py-14 sm:py-24">
        <EmptyState title={t.counterTitle} className="border-0 bg-shop-sunken" action={<ButtonLink href="/shop" variant="primary">{t.viewShop}</ButtonLink>}>
          {t.notFound}
        </EmptyState>
      </Container>
    );
  }
  const fmt = (n: number) => formatMoney(n, view.currency, locale);
  const showImage = !(view.product.blurred && !viewer && shop.settings.legal.blurSensitiveForGuests);
  return (
    <Container size="narrow" className="py-12 sm:py-20">
      <h1 className="mb-8 text-center text-[2.1rem] leading-[1.05] tracking-[-0.03em] text-shop-ink sm:mb-10 sm:text-[2.6rem]">{t.counterTitle}</h1>
      <OfferProductCard product={view.product} showImage={showImage} locale={locale}>
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
        {view.note ? <p className="rounded-shop bg-shop-sunken px-4 py-3 text-sm whitespace-pre-line">{view.note}</p> : null}
        {view.state === "open" ? (
          <>
            {view.expiresAt ? <p className="text-sm text-shop-ink-2">{t.counterValid(formatOfferDate(view.expiresAt, shop.tenant.timezone, locale))}</p> : null}
            {view.product.available ? <CounterButtons token={token} acceptLabel={t.accept(fmt(view.counterAmount))} /> : <p className="text-sm text-shop-crit">{t.sold}</p>}
          </>
        ) : (
          <p role="status" className="rounded-shop bg-shop-warn-soft px-4 py-3 text-sm text-shop-warn">
            {view.state === "expired" ? t.counterExpired : view.state === "accepted" ? t.counterAccepted : t.counterClosed}
          </p>
        )}
      </OfferProductCard>
    </Container>
  );
}
