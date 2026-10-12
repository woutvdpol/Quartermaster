import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Card, ConfirmDialog, DateTime, InlineAlert, KpiCard, PageHeader, StatusPill, buttonClasses, formatMoney, hintClass } from "@/components/admin/ui";
import { ServiceError, requireStaffContext } from "@/server/context";
import { requireTenantDisplay } from "@/server/tenant-display";
import { AuctionDrawer } from "../_components/AuctionDrawer";
import { LiveRefresh } from "../_components/LiveRefresh";
import { LotPicker } from "../_components/LotPicker";
import { LotsTable } from "../_components/LotsTable";
import { SignalsBox } from "../_components/SignalsBox";
import { auctionsCopy as t } from "../_copy";
import { AUCTION_STATUS_TONE, dateToLocalInput, formatSeconds, isEditable } from "../_lib";
import { getAuctionAdmin, getBidSignals, shopAuctionUrl, shopTermsUrl } from "../_service";
import { cancelAuctionAction, publishAuctionAction } from "../actions";
import { moduleLocked } from "@/components/admin/ModuleGate";

const load = cache(async (id: string) => {
  const ctx = await requireStaffContext();
  try {
    const [auction, tenant] = await Promise.all([getAuctionAdmin(ctx, id), requireTenantDisplay(ctx.tenantId)]);
    return { ctx, auction, tenant };
  } catch (err) {
    if (err instanceof ServiceError && (err.code === "NOT_FOUND" || err.code === "INVALID")) notFound();
    throw err;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { auction } = await load((await params).id);
  return { title: auction.title };
}

export default async function AuctionPage({ params }: { params: Promise<{ id: string }> }) {
  if (await moduleLocked("auctions")) return null; // ModuleGate in layout.tsx shows the upsell
  const { id } = await params;
  const { ctx, auction: a, tenant } = await load(id);
  const showSignals = a.status === "LIVE" || a.status === "CLOSED";
  const signals = showSignals ? await getBidSignals(ctx, a.id) : [];
  const currency = tenant.currency;
  const tz = tenant.timeZone;
  const money = (n: number) => formatMoney(n, currency);
  const single = a.type === "SINGLE";
  const editable = isEditable(a.status);
  const live = a.status === "PUBLISHED" || a.status === "LIVE";
  const over = a.status === "CLOSED" || a.status === "CANCELLED";
  const shopUrl = tenant.primaryHost && a.status !== "DRAFT" && a.status !== "CANCELLED" ? shopAuctionUrl(tenant.primaryHost, a.slug) : null;
  const termsUrl = tenant.primaryHost ? shopTermsUrl(tenant.primaryHost) : null;

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill tone={AUCTION_STATUS_TONE[a.status]}>{t.status[a.status]}</StatusPill>
      {live ? <LiveRefresh auctionId={a.id} /> : null}
      {shopUrl ? (
        <a href={shopUrl} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "secondary" })}>
          {t.header.viewInShop}
        </a>
      ) : null}
      {a.status === "LIVE" || a.status === "CLOSED" ? (
        <Link href={`/admin/auctions/${a.id}/results`} className={buttonClasses({ variant: a.status === "CLOSED" ? "primary" : "secondary" })}>
          {t.header.results}
        </Link>
      ) : null}
      {!over ? (
        <ConfirmDialog
          trigger={t.header.cancel}
          triggerVariant="ghost"
          title={t.header.cancelTitle}
          description={t.header.cancelBody}
          confirmLabel={t.header.cancel}
          cancelLabel={t.header.keep}
          action={cancelAuctionAction}
          fields={{ id: a.id }}
        />
      ) : null}
      {a.status === "DRAFT" ? (
        <ConfirmDialog
          trigger={t.header.publish}
          triggerVariant="primary"
          tone="primary"
          disabled={a.lots.length === 0}
          title={t.header.publishTitle}
          description={
            <ul className="grid list-disc gap-1.5 pl-4">
              {t.header.publishBody(a.lots.length).map((line) => (
                <li key={line}>{line}</li>
              ))}
              <li>
                <DateTime value={a.opensAt} format="long" timeZone={tz} />
              </li>
            </ul>
          }
          confirmLabel={t.header.publish}
          action={publishAuctionAction}
          fields={{ id: a.id }}
        />
      ) : null}
    </div>
  );

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );

  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link href="/admin/auctions" className="hover:underline">
              {t.title}
            </Link>{" "}
            › {t.type[a.type]}
          </>
        }
        title={a.title}
        actions={actions}
      />
      <div className="grid items-start gap-4 p-4 md:px-[22px] md:py-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-4">
          {a.status === "DRAFT" && a.lots.length === 0 ? <InlineAlert tone="info">{t.header.publishNoLots}</InlineAlert> : null}
          <Card title={t.lots.title(a.lots.length)} aside={editable && !(single && a.lots.length >= 1) ? <LotPicker auctionId={a.id} currency={currency} /> : null} padded={false}>
            <LotsTable auctionId={a.id} status={a.status} lots={a.lots} currency={currency} timeZone={tz} />
            <p className={`${hintClass} border-t border-line px-3.5 py-2`}>{t.lots.hint}</p>
          </Card>
        </div>

        <aside className="grid min-w-0 gap-4">
          <Card
            title={t.settings.title}
            aside={
              editable ? (
                <AuctionDrawer
                  trigger={t.settings.edit}
                  triggerSize="sm"
                  triggerVariant="ghost"
                  currency={currency}
                  auction={{
                    id: a.id,
                    type: a.type,
                    title: a.title,
                    opensAt: dateToLocalInput(a.opensAt, tz),
                    firstCloseAt: dateToLocalInput(a.firstCloseAt, tz),
                    gapMinutes: Math.round(a.gapSeconds / 60),
                    extendMinutes: Math.round(a.extendSeconds / 60),
                    payDays: a.payDays,
                  }}
                />
              ) : null
            }
          >
            <dl className="grid gap-2 text-[13.5px]">
              {row(t.settings.type, t.type[a.type])}
              {row(t.settings.opens, <DateTime value={a.opensAt} timeZone={tz} />)}
              {row(single ? t.settings.closes : t.settings.firstClose, <DateTime value={a.firstCloseAt} timeZone={tz} />)}
              {single ? null : row(t.settings.gap, formatSeconds(a.gapSeconds))}
              {row(t.settings.extend, formatSeconds(a.extendSeconds))}
              {row(t.settings.premium, t.settings.premiumValue)}
              {row(t.settings.payDays, t.settings.payDaysValue(a.payDays))}
              {row(t.settings.unsold, t.settings.unsoldValue)}
            </dl>
            <details className="mt-3 text-[13px]">
              <summary className="cursor-pointer text-muted">{t.settings.increments}</summary>
              <table className="mt-2 w-full">
                <tbody>
                  {a.increments.map((b, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="py-1 text-muted">{b.upTo === null ? t.settings.incrementsAbove : t.settings.incrementsUpTo(money(b.upTo))}</td>
                      <td className="py-1 text-right font-mono">{money(b.step)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={`${hintClass} mt-1`}>{t.settings.incrementsHint}</p>
            </details>
            {termsUrl ? (
              <a href={termsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-[13px] text-accent hover:underline">
                {t.settings.terms}
              </a>
            ) : null}
          </Card>

          {a.status !== "DRAFT" ? (
            <Card title={over ? t.live.titleAfter : t.live.title}>
              <div className="grid grid-cols-2 gap-2">
                <KpiCard label={t.live.bids} value={a.stats.bids} />
                <KpiCard label={t.live.bidders} value={a.stats.bidders} />
                <KpiCard label={over ? t.live.totalAfter : t.live.total} value={money(a.stats.currentTotal)} />
                <KpiCard label={t.live.aboveReserve} value={a.stats.lotsAboveReserve} />
              </div>
            </Card>
          ) : null}

          <SignalsBox auctionId={a.id} signals={signals} currency={currency} timeZone={tz} />
        </aside>
      </div>
    </>
  );
}
