import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  DateTime,
  KpiCard,
  Money,
  PageHeader,
  ViewTabs,
  buttonClasses,
  cx,
  formatMoney,
  hintClass,
  type Column,
  type SearchParamsRecord,
} from "@/components/admin/ui";
import { ServiceError, requireStaffContext } from "@/server/context";
import { requireTenantDisplay } from "@/server/tenant-display";
import { auctionsCopy as t } from "../../_copy";
import { filterCounts, formatPercent, matchesFilter, parseResultFilter, resultKind, vsList, type ResultKind } from "../../_lib";
import { getAuctionResults } from "../../_service";
import type { ResultRow } from "../../_types";
import { cancelWonLotAction, sendReminderAction } from "../../actions";

export const metadata: Metadata = { title: "Auction results" };

const r = t.results;

const PAY_TONE: Record<ResultKind, string> = {
  paid: "text-ok",
  awaiting: "text-warn",
  overdue: "text-crit",
  unsold: "text-muted",
  cancelled: "text-muted",
  open: "text-muted",
};

export default async function AuctionResultsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParamsRecord> }) {
  const [{ id }, sp, ctx] = await Promise.all([params, searchParams, requireStaffContext()]);
  const [data, tenant] = await Promise.all([
    getAuctionResults(ctx, id).catch((err) => {
      if (err instanceof ServiceError && (err.code === "NOT_FOUND" || err.code === "INVALID")) notFound();
      throw err;
    }),
    requireTenantDisplay(ctx.tenantId),
  ]);
  const { auction, rows } = data;
  const currency = tenant.currency;
  const tz = tenant.timeZone;
  const payDays = auction.payDays;
  const filter = parseResultFilter(sp.filter);
  const base = `/admin/auctions/${auction.id}/results`;

  const withKind = rows.map((row) => ({ ...row, kind: resultKind(row, payDays) }));
  const counts = filterCounts(withKind.map((x) => x.kind));
  const visible = withKind.filter((x) => matchesFilter(x.kind, filter));
  const sold = withKind.filter((x) => x.lotStatus === "SOLD");
  const paid = sold.filter((x) => x.kind === "paid").length;
  const hammerTotal = sold.reduce((s, x) => s + (x.hammer ?? 0), 0);
  const delta = vsList(sold.map((x) => ({ hammer: x.hammer ?? 0, listPrice: x.listPrice })));
  const back = withKind.filter((x) => x.kind === "unsold" || x.kind === "cancelled").length;
  const closed = withKind.filter((x) => x.kind !== "open").length;

  type Row = ResultRow & { kind: ResultKind };

  const resultLabel = (x: Row) =>
    x.lotStatus === "SOLD" ? r.result.SOLD : x.lotStatus === "UNSOLD" ? (x.reserveMet === false && x.hammer !== null ? r.result.notMet : r.result.noBids) : r.result[x.lotStatus];

  const paymentLabel = (x: Row) => {
    switch (x.kind) {
      case "paid":
        return r.payment.paid;
      case "awaiting":
        return r.payment.awaiting(Math.max(1, (x.daysSinceClose ?? 0) + 1), payDays);
      case "overdue":
        return r.payment.overdue(x.daysSinceClose ?? 0);
      case "unsold":
        return r.payment.back;
      case "cancelled":
        return r.payment.cancelled;
      case "open":
        return r.payment.open;
    }
  };

  const columns: Column<Row>[] = [
    { key: "lot", header: r.cols.lot, cell: (x) => <span className="font-mono">{x.lotNumber}</span> },
    {
      key: "item",
      header: r.cols.item,
      cell: (x) => (
        <span className="min-w-0">
          <Link href={`/admin/inventory/${x.productId}`} className="block font-mono text-xs text-muted hover:underline">
            No. {x.stockCode}
          </Link>
          <span className="block max-w-[30ch] truncate">{x.title}</span>
        </span>
      ),
    },
    { key: "result", header: r.cols.result, hideBelow: "md", cell: (x) => resultLabel(x) },
    {
      key: "hammer",
      header: r.cols.hammer,
      numeric: true,
      cell: (x) => (x.hammer === null ? <span className="text-muted">—</span> : <Money amount={x.hammer} currency={currency} mono className="font-semibold" />),
    },
    {
      key: "winner",
      header: r.cols.winner,
      cell: (x) =>
        x.winner && x.lotStatus === "SOLD" ? (
          <Link href={`/admin/customers/${x.winner.customerId}`} className="hover:underline" title={x.winner.email}>
            {x.winner.name}
            {x.winner.bidderNumber !== null ? <span className="text-muted"> · {r.bidder(x.winner.bidderNumber)}</span> : null}
          </Link>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "payment",
      header: r.cols.payment,
      cell: (x) => (
        <span className={cx("font-medium", PAY_TONE[x.kind])}>
          {x.orderId ? (
            <Link href={`/admin/orders/${x.orderId}`} className="hover:underline" title={r.order}>
              {paymentLabel(x)}
            </Link>
          ) : (
            paymentLabel(x)
          )}
        </span>
      ),
    },
    {
      key: "action",
      header: r.cols.action,
      cell: (x) =>
        x.kind === "awaiting" || x.kind === "overdue" ? (
          <span className="flex flex-wrap gap-1.5">
            {x.kind === "awaiting" ? (
              <ConfirmDialog
                trigger={r.remind}
                triggerVariant="secondary"
                triggerSize="sm"
                tone="primary"
                title={r.remind}
                description={x.winner ? `${x.winner.name} · ${x.winner.email}` : undefined}
                confirmLabel={r.remind}
                action={sendReminderAction}
                fields={{ auctionId: auction.id, lotId: x.lotId }}
              />
            ) : null}
            <ConfirmDialog
              trigger={x.kind === "overdue" ? r.cancelBlock : r.cancel}
              triggerVariant={x.kind === "overdue" ? "secondary" : "ghost"}
              triggerSize="sm"
              title={r.cancelTitle}
              description={
                <div className="grid gap-2">
                  <p>
                    {x.title} · {formatMoney(x.hammer ?? 0, currency)}
                  </p>
                  <p>{r.cancelBody}</p>
                </div>
              }
              confirmLabel={r.cancel}
              action={cancelWonLotAction}
              fields={{ auctionId: auction.id, lotId: x.lotId }}
            >
              <Checkbox name="block" label={r.cancelAlsoBlock} defaultChecked={x.kind === "overdue"} />
            </ConfirmDialog>
          </span>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link href="/admin/auctions" className="hover:underline">
              {t.title}
            </Link>{" "}
            ›{" "}
            <Link href={`/admin/auctions/${auction.id}`} className="hover:underline">
              {auction.title}
            </Link>
            {auction.closedAt ? (
              <>
                {` · ${r.closedOn} `}
                <DateTime value={auction.closedAt} timeZone={tz} />
              </>
            ) : null}
          </>
        }
        title={r.title}
        actions={
          <a href={`${base}/export`} className={buttonClasses({ variant: "secondary" })} download>
            {r.export}
          </a>
        }
      />
      <div className="grid gap-4 p-4 md:px-[22px] md:py-5">
        <section aria-label="Totals" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <KpiCard label={r.kpi.sold} value={`${sold.length} / ${rows.length}`} />
          <KpiCard label={r.kpi.hammer} value={formatMoney(hammerTotal, currency)} />
          <KpiCard label={r.kpi.vsList} value={formatPercent(delta)} trend={delta === null ? "flat" : delta >= 0 ? "up" : "down"} />
          <KpiCard label={r.kpi.paid} value={`${paid} / ${sold.length}`} />
          <KpiCard label={r.kpi.back} value={back} />
        </section>

        <Card padded={false}>
          <ViewTabs
            label="Filter results"
            param="filter"
            basePath={base}
            searchParams={sp}
            active={filter}
            views={[
              { value: null, label: r.filters.all, count: counts.all },
              { value: "awaiting", label: r.filters.awaiting, count: counts.awaiting },
              { value: "overdue", label: r.filters.overdue, count: counts.overdue },
              { value: "unsold", label: r.filters.unsold, count: counts.unsold },
            ]}
          />
          <DataTable
            caption={r.title}
            columns={columns}
            rows={visible}
            rowKey={(x) => x.lotId}
            stickyHeader={false}
            empty={<p className="px-3 py-4 text-[13px] text-muted">{closed === 0 ? r.notClosed : r.empty}</p>}
          />
          <p className={`${hintClass} border-t border-line px-3.5 py-2`}>{r.note}</p>
        </Card>
      </div>
    </>
  );
}
