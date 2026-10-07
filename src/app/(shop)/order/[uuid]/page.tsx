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
import { uiCopy } from "@/components/shop/ui/_copy";
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
    <Container size="narrow" className="py-8 sm:py-14">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <OrderContent params={params} />
      </Suspense>
    </Container>
  );
}

const TONES = {
  ok: "bg-shop-ok-soft text-shop-ok",
  warn: "bg-shop-warn-soft text-shop-warn",
  crit: "bg-shop-crit-soft text-shop-crit",
  neutral: "bg-shop-surface text-shop-ink-2",
} as const;

const ICONS = {
  ok: <path d="M7 12.5l3.2 3.2L17 9" />,
  warn: <path d="M12 8v4l2.5 1.8" />,
  crit: <path d="M9 9l6 6M15 9l-6 6" />,
  neutral: <path d="M8 12h8" />,
} as const;

function StatusPanel({ view }: { view: OrderStatusView }) {
  const panel = (tone: keyof typeof TONES, title: string, text: string, extra?: React.ReactNode) => (
    <div role="status" className="flex flex-col gap-4 rounded-shop bg-shop-sunken p-5 sm:flex-row sm:gap-5 sm:p-7">
      <span aria-hidden="true" className={cn("grid size-11 shrink-0 place-items-center rounded-shop-control", TONES[tone])}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {ICONS[tone]}
        </svg>
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 className="text-2xl sm:text-[1.75rem]">{title}</h2>
        <p className="text-shop-ink-2">{text}</p>
        {extra ? <div className="mt-2 flex flex-col gap-2 text-shop-ink-2">{extra}</div> : null}
      </div>
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
    <div className="flex flex-col gap-8">
      <SyncHeaderCounts cart={cartCount} />
      <header className="flex flex-col gap-2">
        <h1 className="text-[2.25rem] tracking-tight sm:text-5xl">{t.title(view.number)}</h1>
        <p className="text-sm text-shop-muted">{t.placedOn(placed)}</p>
      </header>

      <StatusPanel view={view} />
      <OrderStatusPoller active={shouldPoll(view.state)} />

      {view.devSimulation ? (
        <section aria-labelledby="dev-sim" className="rounded-shop border border-dashed border-shop-warn bg-shop-surface px-5 py-5">
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
                <PendingButton variant={outcome === "paid" ? "primary" : "outline"} size="sm" className="h-11! sm:h-9!">
                  {label}
                </PendingButton>
              </form>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="order-items" className="border-t border-shop-line pt-7">
        <h2 id="order-items" className="mb-2 text-2xl">
          {t.items}
        </h2>
        <ul className="divide-y divide-shop-line border-b border-shop-line">
          {view.lines.map((l, i) => (
            <li key={i} className="flex items-center gap-4 py-4">
              <span className="relative block aspect-[4/5] w-14 shrink-0 overflow-hidden rounded-shop bg-shop-sunken">
                {l.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- pre-generated thumb variant
                  <img src={l.imageUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                ) : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                {shop.settings.catalog.showStockCode && l.stockCode !== null ? (
                  <span className="font-shop-mono text-xs text-shop-accent">
                    {uiCopy.product.stockCode} {l.stockCode}
                  </span>
                ) : null}
                <span className="leading-snug font-medium">
                  {l.title}
                  {l.quantity > 1 ? <span className="text-shop-muted"> × {l.quantity}</span> : null}
                </span>
              </span>
              <span className="shrink-0 font-bold tabular-nums">{fmt(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 ml-auto flex max-w-sm flex-col gap-2.5 text-[0.95rem]">
          <div className="flex justify-between">
            <dt className="text-shop-ink-2">{t.subtotal}</dt>
            <dd className="font-medium tabular-nums">{fmt(view.subtotal)}</dd>
          </div>
          {view.discountTotal > 0 ? (
            <div className="flex justify-between">
              <dt className="text-shop-ink-2">
                {cartCopy.coupon.discount}
                {view.couponCode ? <span className="text-shop-muted"> · {view.couponCode}</span> : null}
              </dt>
              <dd className="font-medium tabular-nums">−{fmt(view.discountTotal)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-shop-ink-2">
              {t.shipping}
              {view.shipping?.option ? <span className="text-shop-muted"> · {view.shipping.option}</span> : null}
            </dt>
            <dd className="font-medium tabular-nums">{fmt(view.shippingTotal)}</dd>
          </div>
          {view.surchargeTotal > 0 ? (
            <div className="flex justify-between">
              <dt className="text-shop-ink-2">{view.surchargeLabel}</dt>
              <dd className="font-medium tabular-nums">{fmt(view.surchargeTotal)}</dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between border-t border-shop-line-strong/40 pt-3">
            <dt className="font-semibold">{t.total}</dt>
            <dd className="font-shop-heading text-2xl font-semibold tracking-tight tabular-nums">{fmt(view.total)}</dd>
          </div>
        </dl>
      </section>

      {view.shipping ? (
        <dl className="grid gap-5 rounded-shop border border-shop-line p-5 sm:grid-cols-2 sm:p-6">
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-shop-muted">{view.shipping.method === "PICKUP" ? t.pickup : t.shipTo}</dt>
            <dd className="text-shop-ink">
              {view.shipping.name}
              <br />
              {view.shipping.city}, {view.shipping.country}
            </dd>
          </div>
          {view.shipping.option ? (
            <div className="flex flex-col gap-1">
              <dt className="text-sm text-shop-muted">{t.shipping}</dt>
              <dd className="text-shop-ink">{view.shipping.option}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <p className="text-xs text-shop-muted">{t.privacyNote}</p>
      <ButtonLink href="/shop" variant="outline" className="self-start">
        {t.backToShop}
      </ButtonLink>
    </div>
  );
}
