import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  InlineAlert,
  Money,
  PageHeader,
  StatusPill,
  WipBadge,
  buttonClasses,
  formatDate,
  type StatusTone,
} from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { listOrders, type OrderListItem } from "@/server/orders/queries";
import { countryName, paymentMethodLabel } from "../orders/_lib/labels";
import { requireTenantDisplay } from "@/server/tenant-display";
import { boardCopy } from "./_copy";

const t = boardCopy;

export const metadata: Metadata = { title: t.title };

const OPEN_LIMIT = 200;
const SHIPPED_LIMIT = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

type Card = { order: OrderListItem; pill: { tone: StatusTone; label: string } };

function OrderCard({ order, pill }: Card) {
  const who = [order.customerName, order.shipTo ? order.shipTo.countryCode : null, t.items(order.lineCount)]
    .filter(Boolean)
    .join(" · ");
  return (
    <li>
      <Link
        href={`/admin/orders/${order.id}`}
        className="grid gap-1 rounded-control border border-line bg-panel-2 px-2.5 py-2 text-[12.5px] transition-colors hover:border-line-strong hover:bg-panel"
      >
        <span className="flex items-baseline justify-between gap-2">
          <b className="font-mono">#{order.number}</b>
          <Money amount={order.total} currency={order.currency} mono />
        </span>
        <span
          className="truncate text-ink-2"
          title={order.shipTo ? (countryName(order.shipTo.countryCode) ?? undefined) : undefined}
        >
          {who}
        </span>
        <span>
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
        </span>
      </Link>
    </li>
  );
}

function Lane({ title, count, aside, children }: { title: string; count: number; aside?: ReactNode; children: ReactNode }) {
  const id = `lane-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="grid content-start gap-2 rounded-card border border-line bg-panel p-2.5 shadow-card">
      <h2 id={id} className="type-label flex items-center justify-between gap-2 text-[13px] text-ink">
        {title}
        <span className="font-mono text-xs text-muted">{count}</span>
      </h2>
      {aside && <p className="text-xs text-muted">{aside}</p>}
      {children}
    </section>
  );
}

function CardList({ cards }: { cards: Card[] }) {
  if (cards.length === 0) {
    return (
      <p className="rounded-control border border-dashed border-line px-2.5 py-3 text-center text-xs text-muted">{t.empty}</p>
    );
  }
  return (
    <ul className="grid gap-2">
      {cards.map((c) => (
        <OrderCard key={c.order.id} {...c} />
      ))}
    </ul>
  );
}

/** Splits open orders into the first three lanes, oldest first (the order they get handled in). */
function bucketOpenOrders(items: OrderListItem[], timeZone: string) {
  const now = Date.now();
  const date = (d: Date | null) => (d ? formatDate(d, "date", timeZone) : "");
  const awaiting: Card[] = [];
  const packing: Card[] = [];
  const ready: Card[] = [];
  for (const order of [...items].reverse()) {
    if (order.paymentStatus === "PENDING") {
      const days = Math.max(1, Math.ceil((now - order.placedAt.getTime()) / DAY_MS));
      const method = paymentMethodLabel(order.paymentMethod);
      awaiting.push({
        order,
        pill: {
          tone: "info",
          label: [method, t.day(days)].filter(Boolean).join(" · "),
        },
      });
    } else if (order.fulfillmentStatus === "PACKED") {
      ready.push({ order, pill: { tone: "mute", label: t.packed } });
    } else {
      packing.push({
        order,
        pill: { tone: "warn", label: t.paid(date(order.paidAt)) },
      });
    }
  }
  return { awaiting, packing, ready };
}

export default async function ShippingBoardPage() {
  const ctx = await requireStaffContext();
  const [open, shipped, display] = await Promise.all([
    listOrders(ctx, { view: "open", pageSize: OPEN_LIMIT }),
    listOrders(ctx, { view: "shipped", pageSize: SHIPPED_LIMIT }),
    requireTenantDisplay(ctx.tenantId),
  ]);
  const { awaiting, packing, ready } = bucketOpenOrders(open.items, display.timeZone);
  const shippedCards: Card[] = shipped.items.map((order) => ({
    order,
    pill: order.fulfillmentStatus === "DELIVERED" ? { tone: "ok", label: t.delivered } : { tone: "ok", label: t.shipped },
  }));

  return (
    <>
      <PageHeader
        crumb={
          <Link href="/admin/orders" className="hover:text-ink hover:underline">
            {t.crumb}
          </Link>
        }
        title={t.title}
        actions={
          <>
            <WipBadge />
            <Link href="/admin/orders" className={buttonClasses()}>
              {t.list}
            </Link>
          </>
        }
      />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <InlineAlert
          tone="warn"
          title={
            <span className="inline-flex items-center gap-2">
              {t.wipTitle} <WipBadge />
            </span>
          }
        >
          {t.wipBody}
          {open.total > OPEN_LIMIT && <> {t.truncated(OPEN_LIMIT)}</>}
        </InlineAlert>
        <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Lane title={t.lanes.awaiting} count={awaiting.length}>
            <CardList cards={awaiting} />
          </Lane>
          <Lane title={t.lanes.packing} count={packing.length}>
            <CardList cards={packing} />
          </Lane>
          <Lane title={t.lanes.ready} count={ready.length}>
            <CardList cards={ready} />
          </Lane>
          <Lane title={t.lanes.shipped} count={shipped.total} aside={t.shippedRecent(shipped.items.length, shipped.total)}>
            <CardList cards={shippedCards} />
          </Lane>
        </div>
      </div>
    </>
  );
}
