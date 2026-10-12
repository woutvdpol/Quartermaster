"use client";

import { useState, useTransition } from "react";
import { Button, ConfirmDialog, Drawer, Money, Spinner, StatusPill, Textarea, formatDate, formatMoney } from "@/components/admin/ui";
import type { ReviewBid } from "../_data";
import type { BidSignal } from "../_types";
import { blockBiddersAction, listBidsForReviewAction, voidBidAction } from "../actions";
import { auctionsCopy as t } from "../_copy";

const s = t.signals;

function bidderLabel(c: { name: string; bidderNumber: number | null }): string {
  return c.bidderNumber !== null ? `Bidder ${c.bidderNumber} (${c.name})` : c.name;
}

function joinNames(names: string[]): string {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Check this" box: suspicious bidder pairs with Review bids (void with reason) and Block. */
export function SignalsBox({ auctionId, signals, currency, timeZone }: { auctionId: string; signals: BidSignal[]; currency: string; timeZone: string }) {
  if (!signals.length) return null;
  return (
    <section className="grid gap-3 rounded-card border border-warn bg-warn-soft px-4 py-3.5 text-[13px] text-ink" aria-label={s.title(signals.length)}>
      <strong className="text-[13px]">{s.title(signals.length)}</strong>
      {signals.map((sig, i) => (
        <div key={i} className="grid gap-2">
          <p>{s.text(joinNames(sig.customers.map(bidderLabel)), s.sharedBy[sig.sharedBy], sig.lots.length, sig.against)}</p>
          <div className="flex flex-wrap gap-2">
            <ReviewBids auctionId={auctionId} signal={sig} currency={currency} timeZone={timeZone} />
            <ConfirmDialog
              trigger={s.blockBoth(sig.customers.length)}
              triggerVariant="ghost"
              triggerSize="sm"
              title={s.blockTitle}
              description={
                <div className="grid gap-2">
                  <p>{joinNames(sig.customers.map(bidderLabel))}</p>
                  <p>{s.blockBody}</p>
                </div>
              }
              confirmLabel={s.blockBoth(sig.customers.length)}
              action={blockBiddersAction}
              fields={{ auctionId, customerIds: sig.customers.map((c) => c.customerId).join(",") }}
            >
              <Textarea label={t.reason} name="reason" rows={2} maxLength={500} defaultValue={`Suspicious bidding: shared ${sig.sharedBy}`} />
            </ConfirmDialog>
          </div>
        </div>
      ))}
    </section>
  );
}

function ReviewBids({ auctionId, signal, currency, timeZone }: { auctionId: string; signal: BidSignal; currency: string; timeZone: string }) {
  const [open, setOpen] = useState(false);
  const [bids, setBids] = useState<ReviewBid[] | null>(null);
  const [loading, start] = useTransition();

  const load = () =>
    start(async () => {
      setBids(
        await listBidsForReviewAction(
          auctionId,
          signal.customers.map((c) => c.customerId),
          signal.lots.map((l) => l.lotId),
        ),
      );
    });

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          load();
        }}
      >
        {s.review}
      </Button>
      <Drawer open={open} onOpenChange={setOpen} size="lg" title={s.reviewTitle} description={s.reviewBody}>
        {loading && !bids ? <Spinner label="Loading bids…" /> : null}
        {bids && bids.length === 0 ? <p className="text-sm text-muted">{s.noBids}</p> : null}
        {bids && bids.length > 0 ? (
          <table className="w-full text-sm" aria-busy={loading || undefined}>
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th scope="col" className="py-2 pr-2 font-medium">
                  {s.cols.lot}
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  {s.cols.bidder}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  {s.cols.amount}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  {s.cols.max}
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  {s.cols.time}
                </th>
                <th scope="col" className="py-2 pl-2">
                  <span className="sr-only">{s.cols.action}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {bids.map((b) => (
                <tr key={b.id} className={b.voidedAt ? "border-b border-line text-muted line-through last:border-0" : "border-b border-line last:border-0"}>
                  <td className="py-1.5 pr-2 align-top">
                    <span className="font-mono">{b.lotNumber}</span>
                    <span className="block max-w-[20ch] truncate text-xs text-muted">{b.title}</span>
                  </td>
                  <td className="px-2 py-1.5 align-top">{bidderLabel(b)}</td>
                  <td className="px-2 py-1.5 text-right align-top">
                    <Money amount={b.amount} currency={currency} mono />
                    {b.isAuto ? <span className="block text-xs text-muted">{s.auto}</span> : null}
                  </td>
                  <td className="px-2 py-1.5 text-right align-top">
                    <Money amount={b.maxAmount} currency={currency} mono />
                  </td>
                  <td className="px-2 py-1.5 align-top font-mono text-xs whitespace-nowrap">{formatDate(b.createdAt, "datetime", timeZone)}</td>
                  <td className="py-1.5 pl-2 text-right align-top">
                    {b.voidedAt ? (
                      <StatusPill tone="mute">{s.voided}</StatusPill>
                    ) : (
                      <ConfirmDialog
                        trigger={s.void}
                        triggerVariant="ghost"
                        triggerSize="sm"
                        title={s.voidTitle}
                        description={s.voidBody(bidderLabel(b), formatMoney(b.amount, currency))}
                        confirmLabel={s.void}
                        action={async (fd: FormData) => {
                          const res = await voidBidAction(fd);
                          if (res.ok) load();
                          return res;
                        }}
                        fields={{ auctionId, bidId: b.id }}
                      >
                        <Textarea label={s.reason} name="reason" rows={2} maxLength={500} required />
                      </ConfirmDialog>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Drawer>
    </>
  );
}
