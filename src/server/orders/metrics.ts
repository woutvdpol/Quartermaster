import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { requireTenantDisplay } from "@/server/tenant-display";
import type { ServiceContext } from "@/server/context";

/*
 * Dashboard metrics. Definitions (fixing legacy, which counted unpaid "manual" orders as turnover):
 *  - Revenue  = Σ Order.subtotal of PAID orders (excl. shipping AND payment surcharge, = Σ line totals,
 *               consistent with the margin report). PENDING / FAILED / REFUNDED never count.
 *  - Period   = last `days` tenant-local calendar days incl. today (tenant timezone), up to now;
 *               an order belongs to the day it was paid (COALESCE(paidAt, placedAt) for legacy rows).
 *  - Previous = the `days` local days directly before.
 *  - Margin % = (Σ lineTotal − Σ purchasePriceSnapshot×qty) / Σ lineTotal over lines WITH a cost snapshot.
 * Timestamps are stored as UTC `timestamp(3)`; SQL converts with `AT TIME ZONE 'UTC' AT TIME ZONE tz`.
 */

const daysSchema = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) });

async function tenantTimezone(tenantId: string): Promise<string> {
  return (await requireTenantDisplay(tenantId)).timeZone; // request-cached tenant read
}

export type Kpi = { value: number; previous: number; changePct: number | null };

function kpi(value: number, previous: number): Kpi {
  return { value, previous, changePct: previous === 0 ? null : Math.round(((value - previous) / previous) * 1000) / 10 };
}

export async function kpis(ctx: ServiceContext, opts: { days?: number } = {}) {
  const { days } = daysSchema.parse(opts);
  const tz = await tenantTimezone(ctx.tenantId);

  const [row] = await db.$queryRaw<
    {
      cur_start: string;
      prev_start: string;
      rev_cur: bigint;
      rev_prev: bigint;
      cnt_cur: number;
      cnt_prev: number;
      costed_rev_cur: bigint;
      costed_rev_prev: bigint;
      cost_cur: bigint;
      cost_prev: bigint;
    }[]
  >`
    WITH b AS (
      SELECT
        ((date_trunc('day', now() AT TIME ZONE ${tz}) - make_interval(days => ${days - 1})) AT TIME ZONE ${tz}) AT TIME ZONE 'UTC' AS cur_start,
        ((date_trunc('day', now() AT TIME ZONE ${tz}) - make_interval(days => ${2 * days - 1})) AT TIME ZONE ${tz}) AT TIME ZONE 'UTC' AS prev_start
    ),
    o AS (
      SELECT o.id, o.subtotal, (COALESCE(o."paidAt", o."placedAt") >= b.cur_start) AS cur
      FROM orders o, b
      WHERE o."tenantId" = ${ctx.tenantId} AND o."paymentStatus" = 'PAID'
        AND COALESCE(o."paidAt", o."placedAt") >= b.prev_start
    ),
    l AS (
      SELECT o.cur,
             SUM(ol."lineTotal") FILTER (WHERE ol."purchasePriceSnapshot" IS NOT NULL) AS costed_rev,
             SUM(ol."purchasePriceSnapshot"::bigint * ol.quantity) AS cost
      FROM o JOIN order_lines ol ON ol."orderId" = o.id
      GROUP BY o.cur
    )
    SELECT to_char(b.cur_start, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS cur_start,
      to_char(b.prev_start, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS prev_start,
      COALESCE((SELECT SUM(subtotal) FROM o WHERE cur), 0)::bigint AS rev_cur,
      COALESCE((SELECT SUM(subtotal) FROM o WHERE NOT cur), 0)::bigint AS rev_prev,
      (SELECT COUNT(*) FROM o WHERE cur)::int AS cnt_cur,
      (SELECT COUNT(*) FROM o WHERE NOT cur)::int AS cnt_prev,
      COALESCE((SELECT costed_rev FROM l WHERE cur), 0)::bigint AS costed_rev_cur,
      COALESCE((SELECT costed_rev FROM l WHERE NOT cur), 0)::bigint AS costed_rev_prev,
      COALESCE((SELECT cost FROM l WHERE cur), 0)::bigint AS cost_cur,
      COALESCE((SELECT cost FROM l WHERE NOT cur), 0)::bigint AS cost_prev
    FROM b`;

  const n = (v: bigint | number) => Number(v);
  const aov = (rev: number, cnt: number) => (cnt === 0 ? 0 : Math.round(rev / cnt));
  const marginPct = (costedRev: number, cost: number) => (costedRev === 0 ? 0 : Math.round(((costedRev - cost) / costedRev) * 1000) / 10);

  const rev = [n(row.rev_cur), n(row.rev_prev)];
  const cnt = [row.cnt_cur, row.cnt_prev];
  return {
    days,
    timezone: tz,
    periodStart: new Date(row.cur_start),
    previousStart: new Date(row.prev_start),
    revenue: kpi(rev[0], rev[1]),
    orderCount: kpi(cnt[0], cnt[1]),
    averageOrderValue: kpi(aov(rev[0], cnt[0]), aov(rev[1], cnt[1])),
    marginPct: kpi(marginPct(n(row.costed_rev_cur), n(row.cost_cur)), marginPct(n(row.costed_rev_prev), n(row.cost_prev))),
  };
}

/**
 * Paid revenue (subtotal) and paid-order count per tenant-local day for the last `days` days
 * (incl. today), zero-filled. One query (legacy did 60).
 */
export async function revenueByDay(ctx: ServiceContext, opts: { days?: number } = {}) {
  const { days } = daysSchema.parse(opts);
  const tz = await tenantTimezone(ctx.tenantId);
  const rows = await db.$queryRaw<{ day: string; revenue: bigint; orders: number }[]>`
    WITH d AS (
      SELECT generate_series(
        (now() AT TIME ZONE ${tz})::date - ${days - 1}::int,
        (now() AT TIME ZONE ${tz})::date,
        interval '1 day')::date AS day
    ),
    o AS (
      SELECT ((COALESCE("paidAt", "placedAt") AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date AS day, subtotal
      FROM orders
      WHERE "tenantId" = ${ctx.tenantId} AND "paymentStatus" = 'PAID'
        AND COALESCE("paidAt", "placedAt") >= (now() - make_interval(days => ${days + 1})) AT TIME ZONE 'UTC'
    )
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(SUM(o.subtotal), 0)::bigint AS revenue, COUNT(o.day)::int AS orders
    FROM d LEFT JOIN o ON o.day = d.day
    GROUP BY d.day
    ORDER BY d.day`;
  return rows.map((r) => ({ day: r.day, revenue: Number(r.revenue), orders: r.orders }));
}

/** Counts for the dashboard "to do" panel. */
export async function todoCounts(ctx: ServiceContext) {
  const [row] = await db.$queryRaw<
    { paid_not_shipped: number; pending_bank_transfers: number; open_payments: number; failed_last_7d: number; active_reservations: number }[]
  >`
    SELECT
      (SELECT COUNT(*) FROM orders WHERE "tenantId" = ${ctx.tenantId} AND "archivedAt" IS NULL
         AND "paymentStatus" = 'PAID' AND "fulfillmentStatus" IN ('UNFULFILLED', 'PACKED'))::int AS paid_not_shipped,
      (SELECT COUNT(*) FROM orders o WHERE o."tenantId" = ${ctx.tenantId} AND o."archivedAt" IS NULL AND o."paymentStatus" = 'PENDING'
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p."orderId" = o.id AND p.provider = 'MOLLIE'))::int AS pending_bank_transfers,
      (SELECT COUNT(*) FROM orders o WHERE o."tenantId" = ${ctx.tenantId} AND o."archivedAt" IS NULL AND o."paymentStatus" = 'PENDING'
         AND EXISTS (SELECT 1 FROM payments p WHERE p."orderId" = o.id AND p.provider = 'MOLLIE'))::int AS open_payments,
      (SELECT COUNT(*) FROM orders WHERE "tenantId" = ${ctx.tenantId}
         AND "paymentStatus" IN ('FAILED', 'CANCELED', 'EXPIRED')
         AND "placedAt" >= (now() - interval '7 days') AT TIME ZONE 'UTC')::int AS failed_last_7d,
      (SELECT COUNT(*) FROM reservations WHERE "tenantId" = ${ctx.tenantId} AND status = 'ACTIVE'
         AND "expiresAt" > now() AT TIME ZONE 'UTC')::int AS active_reservations`;
  return {
    paidNotShipped: row.paid_not_shipped,
    pendingBankTransfers: row.pending_bank_transfers,
    openPayments: row.open_payments,
    failedLast7Days: row.failed_last_7d,
    activeReservations: row.active_reservations,
  };
}
