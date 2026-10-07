"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog, DateTime, Drawer, InlineAlert, KeyValue, Money, MoneyInput, StatusPill, Textarea, Thumb, Timeline, formatMoney } from "@/components/admin/ui";
import type { OfferDetail } from "@/server/offers";
import { acceptOfferAction, counterOfferAction, rejectOfferAction } from "../actions";
import { OFFER_STATUS_TONE, offersCopy as t } from "../_copy";

/** Offer detail side panel, opened by `?offer=<id>`; closing removes the param. */
export function OfferDrawer({ offer, closeHref, timeZone }: { offer: OfferDetail; closeHref: string; timeZone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const money = (n: number | null) => (n === null ? "—" : formatMoney(n, offer.currency));
  const p = offer.product;
  const canAnswer = offer.status === "PENDING" || offer.status === "COUNTERED";
  const canReject = canAnswer || offer.status === "ACCEPTED";
  const fields = { id: offer.id };

  const history = [
    { id: "created", title: `Offer of ${money(offer.amount)} received`, meta: <DateTime value={offer.createdAt} format="datetime" timeZone={timeZone} />, highlight: true },
    ...offer.events.map((e) => {
      const data = (e.data ?? {}) as { note?: string | null; counterAmount?: number };
      return {
        id: e.id,
        title: `${t.events[e.action] ?? e.action}${data.counterAmount ? ` · ${money(data.counterAmount)}` : ""}`,
        meta: (
          <>
            <DateTime value={e.createdAt} format="datetime" timeZone={timeZone} />
            {e.actor ? ` · ${e.actor}` : " · customer"}
          </>
        ),
        body: data.note ? <span className="whitespace-pre-line">{data.note}</span> : undefined,
      };
    }),
    ...(offer.order ? [{ id: "order", title: `Ordered as #${offer.order.number}`, tone: "ok" as const }] : []),
  ];

  const noteField = <Textarea label={t.actions.note} name="note" rows={3} maxLength={1000} />;

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) router.replace(closeHref, { scroll: false });
      }}
      size="lg"
      title={`${offer.name} · ${money(offer.amount)}`}
      description={
        <span className="inline-flex items-center gap-2">
          <StatusPill tone={OFFER_STATUS_TONE[offer.status]}>{t.status[offer.status]}</StatusPill>
          <DateTime value={offer.createdAt} format="relative" timeZone={timeZone} />
        </span>
      }
      footer={
        canReject ? (
          <div className="flex flex-wrap justify-end gap-2">
            <ConfirmDialog trigger={t.actions.reject} triggerVariant="ghost" title={t.actions.rejectTitle} description={t.actions.rejectBody} confirmLabel={t.actions.reject} action={rejectOfferAction} fields={fields}>
              {noteField}
            </ConfirmDialog>
            {canAnswer ? (
              <>
                <ConfirmDialog trigger={t.actions.counter} triggerVariant="secondary" tone="primary" title={t.actions.counterTitle} description={t.actions.counterBody} confirmLabel={t.actions.counter} action={counterOfferAction} fields={fields}>
                  <div className="grid gap-3">
                    <MoneyInput label={t.actions.counterAmount} name="counterAmount" currency={offer.currency} defaultValue={offer.counterAmount ?? Math.round((offer.amount + p.price) / 2)} required hint={`Between ${money(offer.amount + 1)} and ${money(p.price)}`} />
                    {noteField}
                  </div>
                </ConfirmDialog>
                <ConfirmDialog trigger={t.actions.accept} triggerVariant="primary" tone="primary" title={t.actions.acceptTitle} description={t.actions.acceptBody(money(offer.amount))} confirmLabel={t.actions.accept} action={acceptOfferAction} fields={fields} disabled={!p.available}>
                  {noteField}
                </ConfirmDialog>
              </>
            ) : null}
          </div>
        ) : undefined
      }
    >
      <div className="grid gap-5">
        <section aria-label={t.detail.product} className="flex gap-3">
          <Thumb src={p.thumb} alt="" size="lg" />
          <div className="grid content-start gap-1">
            <Link href={`/admin/inventory/${p.id}`} className="font-medium text-ink hover:underline">
              {p.title}
            </Link>
            <span className="font-mono text-xs text-muted">#{p.stockCode}</span>
          </div>
        </section>
        {!p.available ? <InlineAlert tone="warn">{t.detail.unavailable}</InlineAlert> : null}

        <KeyValue
          items={[
            { label: t.detail.listPrice, value: <Money amount={p.price} currency={offer.currency} />, mono: true },
            { label: t.detail.offer, value: <span className="font-semibold">{money(offer.amount)}{offer.percent !== null ? ` (${offer.percent}%)` : ""}</span>, mono: true },
            ...(p.purchasePrice !== null ? [{ label: t.detail.cost, value: money(p.purchasePrice), mono: true }] : []),
            { label: t.detail.minimum, value: money(offer.minimum), mono: true },
            ...(offer.counterAmount !== null ? [{ label: t.detail.counter, value: money(offer.counterAmount), mono: true }] : []),
            ...(offer.agreedAmount !== null ? [{ label: t.detail.agreed, value: money(offer.agreedAmount), mono: true }] : []),
            ...(offer.checkoutExpiresAt && (offer.status === "ACCEPTED" || offer.status === "COUNTERED")
              ? [{ label: t.detail.linkValid, value: <DateTime value={offer.checkoutExpiresAt} format="datetime" timeZone={timeZone} /> }]
              : []),
            ...(offer.order ? [{ label: t.detail.order, value: <Link className="text-accent hover:underline" href={`/admin/orders/${offer.order.id}`}>#{offer.order.number}</Link> }] : []),
          ]}
        />

        <section className="grid gap-1.5">
          <h3 className="type-label text-xs text-muted">{t.detail.customer}</h3>
          <p className="text-[13px] text-ink">
            {offer.name} · <a className="text-accent hover:underline" href={`mailto:${offer.email}`}>{offer.email}</a>
            {offer.customer ? (
              <>
                {" · "}
                <Link className="text-accent hover:underline" href={`/admin/customers/${offer.customer.id}`}>customer profile</Link>
              </>
            ) : null}
          </p>
          <h3 className="type-label mt-2 text-xs text-muted">{t.detail.message}</h3>
          <p className="whitespace-pre-line text-[13px] text-ink-2">{offer.message ?? t.detail.noMessage}</p>
        </section>

        <section className="grid gap-2">
          <h3 className="type-label text-xs text-muted">{t.detail.history}</h3>
          <Timeline items={history} />
        </section>

        <section className="grid gap-2">
          <h3 className="type-label text-xs text-muted">{t.detail.others}</h3>
          {offer.otherOffers.length === 0 ? (
            <p className="text-[13px] text-muted">{t.detail.noOthers}</p>
          ) : (
            <ul className="grid gap-1 text-[13px]">
              {offer.otherOffers.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <Link href={`/admin/offers?view=all&offer=${o.id}`} className="truncate text-accent hover:underline">
                    {o.name}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="font-mono">{money(o.amount)}</span>
                    <StatusPill tone={OFFER_STATUS_TONE[o.status]}>{t.status[o.status]}</StatusPill>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}
