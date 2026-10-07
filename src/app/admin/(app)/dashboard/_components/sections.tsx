import Link from "next/link";
import {
  Card,
  DateTime,
  EmptyState,
  FulfillmentStatusPill,
  InlineAlert,
  KpiCard,
  Money,
  PaymentStatusPill,
  StatusPill,
  buttonClasses,
  formatMoney,
  type StatusTone,
} from "@/components/admin/ui";
import type { ServiceContext } from "@/server/context";
import { kpis, revenueByDay, todoCounts, type Kpi } from "@/server/orders/metrics";
import { listOrders } from "@/server/orders/queries";
import { stockOverview } from "@/server/stock/ledger";
import { visitorsSummary } from "@/server/analytics";
import { marginReport } from "@/server/purchasing";
import { getTenantFormat } from "../../sourcing/_lib/tenant";
import { addDays, startOfLocalDay, todayIn } from "../../sourcing/_lib/time";
import { copy } from "../_copy";
import { MarginBars } from "./MarginBars";
import { RevenueChart } from "./RevenueChart";
import { Sparkline } from "./Sparkline";

/** Runs a loader; on failure logs and returns null so one broken card doesn't take the page down. */
async function safe<T>(label: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    console.error(`[dashboard] ${label} failed`, e);
    return { ok: false };
  }
}

function SectionError() {
  return (
    <InlineAlert tone="warn" live="none">
      {copy.error.section}
    </InlineAlert>
  );
}

const nf = (n: number) => n.toLocaleString("en-NL");

function trendOf(k: Kpi): "up" | "down" | "flat" {
  return k.value > k.previous ? "up" : k.value < k.previous ? "down" : "flat";
}

// ─── KPIs ───────────────────────────────────────────────────────────────────

export async function KpiSection({ ctx, days }: { ctx: ServiceContext; days: number }) {
  const [res, fmt] = await Promise.all([safe("kpis", () => kpis(ctx, { days })), getTenantFormat(ctx)]);
  if (!res.ok) return <SectionError />;
  const k = res.value;
  const cur = fmt.currency;
  const pct = (k: Kpi) => (k.changePct == null ? undefined : `${Math.abs(k.changePct).toLocaleString("en-NL")}%`);
  const marginDiff = Math.round((k.marginPct.value - k.marginPct.previous) * 10) / 10;

  return (
    <section aria-label={copy.kpis.label(days)} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        label={copy.kpis.revenue}
        value={formatMoney(k.revenue.value, cur)}
        delta={pct(k.revenue)}
        trend={trendOf(k.revenue)}
        note={k.revenue.changePct == null ? copy.kpis.noPrevious : copy.kpis.vsPrevious(days)}
      />
      <KpiCard
        label={copy.kpis.orders}
        value={nf(k.orderCount.value)}
        delta={nf(Math.abs(k.orderCount.value - k.orderCount.previous))}
        trend={trendOf(k.orderCount)}
        note={`${copy.kpis.vs} ${nf(k.orderCount.previous)}`}
      />
      <KpiCard
        label={copy.kpis.aov}
        value={formatMoney(k.averageOrderValue.value, cur)}
        delta={pct(k.averageOrderValue)}
        trend={trendOf(k.averageOrderValue)}
        note={k.averageOrderValue.changePct == null ? copy.kpis.noPrevious : `${copy.kpis.vs} ${formatMoney(k.averageOrderValue.previous, cur)}`}
      />
      <KpiCard
        label={copy.kpis.margin}
        value={`${k.marginPct.value.toLocaleString("en-NL", { maximumFractionDigits: 1 })}%`}
        delta={k.orderCount.previous > 0 ? `${Math.abs(marginDiff).toLocaleString("en-NL")} pp` : undefined}
        trend={k.orderCount.previous > 0 ? trendOf(k.marginPct) : "flat"}
        note={k.orderCount.previous > 0 ? `${copy.kpis.vs} ${k.marginPct.previous.toLocaleString("en-NL")}% · ${copy.kpis.marginNote}` : copy.kpis.marginNote}
      />
    </section>
  );
}

// ─── Revenue chart ──────────────────────────────────────────────────────────

export async function RevenueSection({ ctx, days }: { ctx: ServiceContext; days: number }) {
  const [res, fmt] = await Promise.all([safe("revenueByDay", () => revenueByDay(ctx, { days })), getTenantFormat(ctx)]);
  return (
    <Card title={copy.chart.title} aside={copy.chart.aside}>
      {res.ok ? <RevenueChart data={res.value} currency={fmt.currency} days={days} /> : <SectionError />}
    </Card>
  );
}

// ─── To do ──────────────────────────────────────────────────────────────────

export async function TodoSection({ ctx }: { ctx: ServiceContext }) {
  const res = await safe("todoCounts", () => todoCounts(ctx));
  if (!res.ok) {
    return (
      <Card title={copy.todo.title}>
        <SectionError />
      </Card>
    );
  }
  const t = res.value;
  const items: { label: string; count: number; tone: StatusTone; href: string }[] = [
    { label: copy.todo.paidNotShipped, count: t.paidNotShipped, tone: "warn", href: "/admin/orders?view=toShip" },
    { label: copy.todo.awaitingTransfer, count: t.pendingBankTransfers, tone: "info", href: "/admin/orders?view=open" },
    { label: copy.todo.openPayments, count: t.openPayments, tone: "mute", href: "/admin/orders?view=open" },
    { label: copy.todo.failed, count: t.failedLast7Days, tone: "crit", href: "/admin/orders?view=failed" },
  ];
  const open = t.paidNotShipped + t.pendingBankTransfers + t.openPayments + t.failedLast7Days;

  return (
    <Card title={copy.todo.title} aside={copy.todo.open(open)} padded={false}>
      <ul className="grid py-1.5 text-[13px]">
        {items.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              className="flex items-center justify-between gap-3 px-3.5 py-1.5 hover:bg-panel-2 focus-visible:bg-panel-2"
            >
              <span className={item.count === 0 ? "text-muted" : undefined}>{item.label}</span>
              <StatusPill tone={item.count === 0 ? "mute" : item.tone}>{nf(item.count)}</StatusPill>
            </Link>
          </li>
        ))}
        <li aria-hidden="true" className="mx-3.5 my-1.5 border-t border-line" />
        <li>
          <Link
            href="/admin/inventory?view=inCart"
            className="flex items-center justify-between gap-3 px-3.5 py-1.5 hover:bg-panel-2 focus-visible:bg-panel-2"
          >
            <span className="text-muted">{copy.todo.reserved}</span>
            <span className="font-mono tabular-nums">{nf(t.activeReservations)}</span>
          </Link>
        </li>
      </ul>
      {open === 0 && <p className="border-t border-line px-3.5 py-2 text-xs text-muted">{copy.todo.allClear}</p>}
    </Card>
  );
}

// ─── Visitors ───────────────────────────────────────────────────────────────

export async function VisitorsSection({ ctx, days }: { ctx: ServiceContext; days: number }) {
  const res = await safe("visitorsSummary", () => visitorsSummary(ctx, { days }));
  if (!res.ok) {
    return (
      <Card title={copy.visitors.title}>
        <InlineAlert tone="warn" live="none">
          {copy.visitors.error}
        </InlineAlert>
      </Card>
    );
  }
  const s = res.value;
  if (!s) {
    return (
      <Card title={copy.visitors.title}>
        <EmptyState
          compact
          title={copy.visitors.notConfigured}
          body={copy.visitors.notConfiguredBody}
          action={
            <Link href="/admin/settings/analytics" className={buttonClasses({ size: "sm" })}>
              {copy.visitors.settings}
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <Card title={copy.visitors.title} aside={copy.visitors.aside(days)}>
      <div className="grid gap-3">
        <dl className="grid grid-cols-3 gap-3">
          <div>
            <dt className="type-label text-[11px] text-muted">{copy.visitors.unique}</dt>
            <dd className="m-0 font-mono text-xl font-semibold tabular-nums">{nf(s.totals.visitors)}</dd>
          </div>
          <div>
            <dt className="type-label text-[11px] text-muted">{copy.visitors.pageviews}</dt>
            <dd className="m-0 font-mono text-xl font-semibold tabular-nums">{nf(s.totals.pageviews)}</dd>
          </div>
          <div>
            <dt className="type-label text-[11px] text-muted">{copy.visitors.live}</dt>
            <dd className="m-0 flex items-center gap-1.5 font-mono text-xl font-semibold tabular-nums">
              <span aria-hidden="true" className={`size-2 rounded-full ${s.liveVisitors > 0 ? "bg-ok" : "bg-line-strong"}`} />
              {nf(s.liveVisitors)}
            </dd>
          </div>
        </dl>
        <Sparkline values={s.series.map((d) => d.visitors)} label={copy.visitors.sparkAria(days, s.totals.visitors)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TopList title={copy.visitors.topPages} rows={s.topPages.slice(0, 5).map((p) => ({ key: p.path, label: p.path, value: p.pageviews }))} />
          <TopList
            title={copy.visitors.topReferrers}
            rows={s.topReferrers.slice(0, 5).map((r) => ({ key: r.host, label: r.host, value: r.visitors }))}
          />
        </div>
      </div>
    </Card>
  );
}

function TopList({ title, rows }: { title: string; rows: { key: string; label: string; value: number }[] }) {
  return (
    <div className="min-w-0">
      <h3 className="type-label mb-1 text-[11px] text-muted">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">{copy.visitors.none}</p>
      ) : (
        <ol className="grid gap-1 text-[13px]">
          {rows.map((r) => (
            <li key={r.key} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-xs" title={r.label}>
                {r.label}
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{nf(r.value)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ─── Latest orders ──────────────────────────────────────────────────────────

export async function LatestOrdersSection({ ctx }: { ctx: ServiceContext }) {
  const [res, fmt] = await Promise.all([safe("listOrders", () => listOrders(ctx, { view: "all", pageSize: 5 })), getTenantFormat(ctx)]);
  const aside = (
    <Link href="/admin/orders" className="hover:text-ink">
      {copy.latest.all}
    </Link>
  );
  if (!res.ok) {
    return (
      <Card title={copy.latest.title} aside={aside}>
        <SectionError />
      </Card>
    );
  }
  const orders = res.value.items;
  const th = "type-label whitespace-nowrap border-b border-line px-3 py-2 text-left text-[11px] text-muted";
  const td = "border-b border-line px-3 py-2 align-middle";
  const now = new Date();

  return (
    <Card title={copy.latest.title} aside={aside} padded={false}>
      {orders.length === 0 ? (
        <EmptyState compact title={copy.latest.empty} body={copy.latest.emptyBody} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <caption className="sr-only">{copy.latest.title}</caption>
            <thead>
              <tr>
                <th scope="col" className={th}>{copy.latest.order}</th>
                <th scope="col" className={th}>{copy.latest.customer}</th>
                <th scope="col" className={`${th} hidden md:table-cell`}>{copy.latest.payment}</th>
                <th scope="col" className={`${th} hidden md:table-cell`}>{copy.latest.fulfillment}</th>
                <th scope="col" className={`${th} text-right`}>{copy.latest.total}</th>
              </tr>
            </thead>
            <tbody className="[&>tr:last-child>td]:border-b-0">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-panel-2">
                  <td className={td}>
                    <Link href={`/admin/orders/${o.id}`} className="font-mono font-medium hover:underline">
                      #{o.number}
                    </Link>
                    <div className="text-xs text-muted">
                      <DateTime value={o.placedAt} format="relative" now={now} timeZone={fmt.timeZone} />
                    </div>
                  </td>
                  <td className={`${td} max-w-[14rem] truncate`}>
                    {o.customerName || o.email}
                    {o.shipTo?.countryCode && <span className="ml-1 text-xs text-muted">({o.shipTo.countryCode})</span>}
                  </td>
                  <td className={`${td} hidden md:table-cell`}>
                    <PaymentStatusPill status={o.paymentStatus} />
                  </td>
                  <td className={`${td} hidden md:table-cell`}>
                    <FulfillmentStatusPill status={o.fulfillmentStatus} />
                  </td>
                  <td className={`${td} text-right`}>
                    <Money amount={o.total} currency={o.currency} mono />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Stock strip ────────────────────────────────────────────────────────────

export async function StockSection({ ctx }: { ctx: ServiceContext }) {
  const [res, fmt] = await Promise.all([safe("stockOverview", () => stockOverview(ctx)), getTenantFormat(ctx)]);
  const aside = (
    <Link href="/admin/inventory" className="hover:text-ink">
      {copy.stock.inventory}
    </Link>
  );
  if (!res.ok) {
    return (
      <Card title={copy.stock.title} aside={aside}>
        <SectionError />
      </Card>
    );
  }
  const s = res.value;
  const items = [
    { label: copy.stock.forSale, value: nf(s.forSale), href: "/admin/inventory?view=forSale" },
    { label: copy.stock.reserved, value: nf(s.reservedNow), href: "/admin/inventory?view=inCart" },
    { label: copy.stock.sold30d, value: nf(s.sold30d), href: "/admin/inventory?view=sold" },
    { label: copy.stock.valueAtPrice, value: formatMoney(s.valueAtPrice, fmt.currency) },
    { label: copy.stock.valueAtCost, value: formatMoney(s.valueAtCost, fmt.currency) },
  ];
  return (
    <Card title={copy.stock.title} aside={aside}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((i) => (
          <div key={i.label} className="min-w-0">
            <dt className="type-label text-[11px] text-muted">{i.label}</dt>
            <dd className="m-0 font-mono text-lg font-semibold tabular-nums">
              {i.href ? (
                <Link href={i.href} className="hover:underline">
                  {i.value}
                </Link>
              ) : (
                i.value
              )}
            </dd>
          </div>
        ))}
      </dl>
      {s.withoutPurchasePrice > 0 && (
        <p className="mt-3 text-xs text-muted">
          <span className="text-warn" aria-hidden="true">
            ●{" "}
          </span>
          {copy.stock.withoutCost(s.withoutPurchasePrice)}{" "}
          <Link href="/admin/sourcing" className="text-ink underline">
            Sourcing
          </Link>
        </p>
      )}
    </Card>
  );
}

// ─── Margin by category ─────────────────────────────────────────────────────

const MARGIN_ROWS = 6;

export async function MarginSection({ ctx }: { ctx: ServiceContext }) {
  const fmt = await getTenantFormat(ctx);
  const today = todayIn(fmt.timeZone);
  const from = startOfLocalDay(addDays(today, -29), fmt.timeZone);
  const to = startOfLocalDay(addDays(today, 1), fmt.timeZone);
  const res = await safe("marginReport", () => marginReport(ctx, { from, to, groupBy: "category" }));
  const aside = (
    <Link href="/admin/sourcing/margin" className="hover:text-ink">
      {copy.margin.report}
    </Link>
  );
  if (!res.ok) {
    return (
      <Card title={copy.margin.title} aside={aside}>
        <SectionError />
      </Card>
    );
  }
  const r = res.value;
  const rows = r.groups.slice(0, MARGIN_ROWS);
  return (
    <Card title={`${copy.margin.title} · ${copy.margin.aside}`} aside={aside}>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">{copy.margin.empty}</p>
      ) : (
        <div className="grid gap-3">
          <MarginBars rows={rows} currency={r.currency} />
          {r.groups.length > MARGIN_ROWS && <p className="text-xs text-muted">{copy.margin.more(r.groups.length - MARGIN_ROWS)}</p>}
          {r.totals.linesMissingCost > 0 && (
            <p className="text-xs text-muted">
              <span className="text-warn" aria-hidden="true">
                ●{" "}
              </span>
              {copy.margin.missing(r.totals.linesMissingCost)}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
