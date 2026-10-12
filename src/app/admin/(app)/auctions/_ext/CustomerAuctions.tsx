import "server-only";
import Link from "next/link";
import { Card, ConfirmDialog, DateTime, InlineAlert, StatusPill, Textarea } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { auctionsCopy } from "../_copy";
import { getCustomerAuctionSummary, type CustomerAuctionLot } from "../_data";
import { blockBiddersAction, unblockBidderAction } from "../actions";

const t = auctionsCopy.customer;

function resultPill(l: CustomerAuctionLot) {
  if (l.won) return <StatusPill tone={l.paid ? "ok" : "warn"}>{`${t.won} · ${l.paid ? t.paid : t.unpaid}`}</StatusPill>;
  if (l.leading) return <StatusPill tone="info">{t.leading}</StatusPill>;
  if (l.lotStatus === "OPEN") return <StatusPill tone="mute">{t.lost}</StatusPill>;
  return <StatusPill tone="mute">{auctionsCopy.results.result[l.lotStatus === "SOLD" ? "SOLD" : l.lotStatus]}</StatusPill>;
}

/** Customer page card: block / unblock from auctions and the lots they bid on (self-loading server component). */
export async function CustomerAuctions({ customerId, timeZone, disabled }: { customerId: string; timeZone: string; disabled?: boolean }) {
  const ctx = await requireStaffContext();
  const { blocked, lots } = await getCustomerAuctionSummary(ctx, customerId);
  const won = lots.filter((l) => l.won);
  return (
    <Card title={t.title}>
      <div className="grid gap-3 text-[13px]">
        {blocked ? (
          <InlineAlert tone="crit" title={t.blocked}>
            {t.blockedSince} <DateTime value={blocked.createdAt} format="date" timeZone={timeZone} />
            {blocked.reason ? ` · ${blocked.reason}` : null}
          </InlineAlert>
        ) : null}
        {lots.length === 0 ? (
          <p className="text-muted">{t.none}</p>
        ) : (
          <>
            <p className="text-muted">{t.summary(lots.length, won.length, won.filter((l) => l.paid).length)}</p>
            <ul className="grid gap-1.5">
              {lots.map((l) => (
                <li key={l.lotId} className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <Link href={`/admin/auctions/${l.auctionId}`} className="block truncate hover:underline">
                      <span className="font-mono text-xs text-muted">{l.lotNumber}</span> {l.title}
                    </Link>
                    <span className="block truncate text-xs text-muted">
                      {l.auctionTitle} · {l.bids} {l.bids === 1 ? "bid" : "bids"}
                    </span>
                  </span>
                  {l.orderId ? <Link href={`/admin/orders/${l.orderId}`}>{resultPill(l)}</Link> : resultPill(l)}
                </li>
              ))}
            </ul>
          </>
        )}
        {disabled ? null : (
          <div>
            {blocked ? (
              <ConfirmDialog
                trigger={t.unblock}
                triggerVariant="secondary"
                triggerSize="sm"
                tone="primary"
                title={t.unblockTitle}
                description={t.unblockBody}
                confirmLabel={t.unblock}
                action={unblockBidderAction}
                fields={{ customerId }}
              />
            ) : (
              <ConfirmDialog
                trigger={t.block}
                triggerVariant="ghost"
                triggerSize="sm"
                title={t.blockTitle}
                description={t.blockBody}
                confirmLabel={t.block}
                action={blockBiddersAction}
                fields={{ customerIds: customerId, auctionId: "" }}
              >
                <Textarea label={t.reason} name="reason" rows={2} maxLength={500} />
              </ConfirmDialog>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
