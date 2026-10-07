import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Container } from "@/components/shop/ui/Container";
import { ButtonLink, buttonClasses } from "@/components/shop/ui/Button";
import { Skeleton } from "@/components/shop/ui/Skeleton";
import { cn } from "@/components/shop/ui/cn";
import { formatMoney, SHOP_LOCALE } from "@/components/shop/ui/money";
import { SyncHeaderCounts } from "@/components/shop/layout/HeaderCounts";
import { OrderStatusPoller } from "@/components/shop/cart/OrderStatusPoller";
import { PayOrderForm } from "@/components/shop/cart/PayOrderForm";
import { PendingButton } from "@/components/shop/cart/PendingButton";
import { cartCopy } from "@/components/shop/cart/_copy";
import { requireShop } from "@/server/storefront/context";
import { currentCartCount } from "@/server/cart/cookie";
import { getOrderStatusView, type OrderStatusView } from "@/server/checkout";
import { shouldPoll } from "@/server/checkout/status";
import { simulatePaymentAction } from "./actions";

const t = cartCopy.order;

// The uuid is a secret: keep it out of search engines and referrers.
export const metadata: Metadata = { title: "Order status", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function OrderPage({ params }: PageProps<"/order/[uuid]">) {
  return (
    <Container size="narrow" className="py-8 sm:py-12">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <OrderContent params={params} />
      </Suspense>
    </Container>
  );
}

const TONES = {
  ok: "border-shop-ok/30 bg-shop-ok-soft text-shop-ok",
  warn: "border-shop-warn/30 bg-shop-warn-soft text-shop-warn",
  crit: "border-shop-crit/30 bg-shop-crit-soft text-shop-crit",
  neutral: "border-shop-line bg-shop-sunken text-shop-ink-2",
} as const;

function StatusPanel({ view }: { view: OrderStatusView }) {
  const panel = (tone: keyof typeof TONES, title: string, text: string, extra?: React.ReactNode) => (
    <div role="status" className={cn("flex flex-col gap-3 rounded-shop border px-5 py-5", TONES[tone])}>
      <h2 className="text-2xl">{title}</h2>
      <p className="text-shop-ink-2">{text}</p>
      {extra}
    </div>
  );
  switch (view.state) {
    case "paid":
      return panel("ok", t.paid, t.paidText(view.email));
    case "refunded":
      return panel("neutral", t.refunded, t.refundedText);
    case "canceled":
      return panel("neutral", t.canceled, t.canceledText);
    case "processing":
      return panel("warn", t.processing, t.processingText);
    case "waiting":
      return panel(
        "warn",
        t.waiting,
        t.waitingText,
        view.continueUrl ? (
          <a href={view.continueUrl} rel="noopener noreferrer" className={buttonClasses("primary", "lg", "self-start")}>
            {t.continuePayment}
          </a>
        ) : null,
      );
    case "unpaid":
    case "failed": {
      const failed = view.state === "failed";
      const extra = view.retryExpired ? (
        <p className="text-sm">{t.retryExpired}</p>
      ) : view.retryBlockedBy.length ? (
        <p className="text-sm">{t.retryBlocked(view.retryBlockedBy.join(", "))}</p>
      ) : !view.paymentsConfigured ? (
        <p className="text-sm">{t.notConfigured}</p>
      ) : view.canRetry ? (
        <div className="self-start">
          <PayOrderForm uuid={view.uuid} label={failed ? t.tryAgain : t.payNow} />
        </div>
      ) : null;
      return panel(failed ? "crit" : "warn", failed ? t.failed : t.unpaid, failed ? t.failedText : t.unpaidText, extra);
    }
  }
}

async function OrderContent({ params }: { params: PageProps<"/order/[uuid]">["params"] }) {
  const { uuid } = await params;
  const shop = await requireShop();
  const view = await getOrderStatusView(shop.tenant.id, uuid);
  if (!view) notFound();
  const cartCount = await currentCartCount(shop.tenant.id);
  const fmt = (n: number) => formatMoney(n, view.currency);
  const placed = new Intl.DateTimeFormat(SHOP_LOCALE, { dateStyle: "long", timeStyle: "short", timeZone: shop.tenant.timezone }).format(view.placedAt);

  return (
    <div className="flex flex-col gap-6">
      <SyncHeaderCounts cart={cartCount} />
      <header>
        <h1 className="text-3xl sm:text-4xl">{t.title(view.number)}</h1>
        <p className="mt-1 text-sm text-shop-muted">{t.placedOn(placed)}</p>
      </header>

      <StatusPanel view={view} />
      <OrderStatusPoller active={shouldPoll(view.state)} />

      {view.devSimulation ? (
        <section aria-labelledby="dev-sim" className="rounded-shop border border-dashed border-shop-warn bg-shop-surface px-5 py-4">
          <h2 id="dev-sim" className="font-shop-body text-sm font-semibold tracking-wide text-shop-warn uppercase">
            {t.devTitle}
          </h2>
          <p className="mt-1 text-sm text-shop-ink-2">{t.devText}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                ["paid", t.devPaid],
                ["failed", t.devFailed],
                ["expired", t.devExpired],
              ] as const
            ).map(([outcome, label]) => (
              <form key={outcome} action={simulatePaymentAction}>
                <input type="hidden" name="uuid" value={view.uuid} />
                <input type="hidden" name="outcome" value={outcome} />
                <PendingButton variant={outcome === "paid" ? "primary" : "outline"} size="sm">
                  {label}
                </PendingButton>
              </form>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="order-items" className="rounded-shop border border-shop-line bg-shop-surface p-5">
        <h2 id="order-items" className="mb-3 text-xl">
          {t.items}
        </h2>
        <ul className="divide-y divide-shop-line">
          {view.lines.map((l, i) => (
            <li key={i} className="flex items-center gap-3 py-3">
              <span className="relative block size-14 shrink-0 overflow-hidden rounded-shop-sm bg-shop-sunken">
                {l.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- pre-generated thumb variant
                  <img src={l.imageUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                ) : null}
              </span>
              <span className="flex-1">
                {l.title}
                {l.quantity > 1 ? <span className="text-shop-muted"> × {l.quantity}</span> : null}
              </span>
              <span className="tabular-nums">{fmt(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 flex flex-col gap-1.5 border-t border-shop-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-shop-ink-2">{t.subtotal}</dt>
            <dd className="tabular-nums">{fmt(view.subtotal)}</dd>
          </div>
          {view.discountTotal > 0 ? (
            <div className="flex justify-between">
              <dt className="text-shop-ink-2">
                {cartCopy.coupon.discount}
                {view.couponCode ? <span className="text-shop-muted"> · {view.couponCode}</span> : null}
              </dt>
              <dd className="tabular-nums">−{fmt(view.discountTotal)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-shop-ink-2">
              {t.shipping}
              {view.shipping?.option ? <span className="text-shop-muted"> · {view.shipping.option}</span> : null}
            </dt>
            <dd className="tabular-nums">{fmt(view.shippingTotal)}</dd>
          </div>
          <div className="flex justify-between border-t border-shop-line pt-2 text-base font-semibold">
            <dt>{t.total}</dt>
            <dd className="tabular-nums">{fmt(view.total)}</dd>
          </div>
        </dl>
        {view.shipping ? (
          <p className="mt-4 text-sm text-shop-muted">
            {view.shipping.method === "PICKUP" ? t.pickup : t.shipTo}: {view.shipping.name}, {view.shipping.city}, {view.shipping.country}
          </p>
        ) : null}
      </section>

      <p className="text-xs text-shop-muted">{t.privacyNote}</p>
      <ButtonLink href="/shop" variant="outline" className="self-start">
        {t.backToShop}
      </ButtonLink>
    </div>
  );
}
