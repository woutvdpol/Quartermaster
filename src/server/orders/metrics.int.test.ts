import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { kpis, revenueByDay, todoCounts } from "./metrics";
import { makeOrder, makeProduct } from "./test-fixtures";

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

describe("dashboard metrics", () => {
  beforeEach(resetDb);

  it("counts only PAID revenue excl. shipping, with previous-period comparison and margin", async () => {
    const ctx = await createTenantContext();
    const p1 = await makeProduct(ctx.tenantId, { price: 10000, purchasePrice: 6000 });
    const p2 = await makeProduct(ctx.tenantId, { price: 5000, purchasePrice: null });
    // current period: two paid orders (one line without cost)
    await makeOrder(ctx.tenantId, { lines: [{ product: p1 }], paymentStatus: "PAID", placedAt: daysAgo(1), shippingTotal: 995 });
    await makeOrder(ctx.tenantId, { lines: [{ product: p2 }], paymentStatus: "PAID", placedAt: daysAgo(2) });
    // not revenue: pending bank transfer, failed, refunded
    await makeOrder(ctx.tenantId, { lines: [{ product: p1 }], paymentStatus: "PENDING", placedAt: daysAgo(1) });
    await makeOrder(ctx.tenantId, { lines: [{ product: p1 }], paymentStatus: "FAILED", placedAt: daysAgo(1) });
    await makeOrder(ctx.tenantId, { lines: [{ product: p1 }], paymentStatus: "REFUNDED", placedAt: daysAgo(1) });
    // previous period
    await makeOrder(ctx.tenantId, { lines: [{ product: p1 }], paymentStatus: "PAID", placedAt: daysAgo(40) });
    // outside both periods
    await makeOrder(ctx.tenantId, { lines: [{ product: p1 }], paymentStatus: "PAID", placedAt: daysAgo(90) });
    // other tenant
    const other = await createTenantContext();
    const op = await makeProduct(other.tenantId);
    await makeOrder(other.tenantId, { lines: [{ product: op }], paymentStatus: "PAID", placedAt: daysAgo(1) });

    const k = await kpis(ctx, { days: 30 });
    expect(k.revenue).toEqual({ value: 15000, previous: 10000, changePct: 50 });
    expect(k.orderCount).toEqual({ value: 2, previous: 1, changePct: 100 });
    expect(k.averageOrderValue).toEqual({ value: 7500, previous: 10000, changePct: -25 });
    // margin over costed lines only: (10000 − 6000) / 10000
    expect(k.marginPct.value).toBe(40);
    expect(k.periodStart.getTime()).toBeLessThan(Date.now() - 29 * DAY);
    expect(k.previousStart.getTime()).toBeLessThan(k.periodStart.getTime());
  });

  it("revenueByDay is zero-filled, tenant-local and paid-only", async () => {
    const ctx = await createTenantContext();
    const p = await makeProduct(ctx.tenantId, { price: 1234 });
    await makeOrder(ctx.tenantId, { lines: [{ product: p }], paymentStatus: "PAID", placedAt: new Date() });
    await makeOrder(ctx.tenantId, { lines: [{ product: p }], paymentStatus: "PAID", placedAt: daysAgo(3) });
    await makeOrder(ctx.tenantId, { lines: [{ product: p }], paymentStatus: "PENDING", placedAt: new Date() });

    const series = await revenueByDay(ctx, { days: 7 });
    expect(series).toHaveLength(7);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
    expect(series[6].day).toBe(today);
    expect(series[6]).toMatchObject({ revenue: 1234, orders: 1 });
    expect(series.reduce((s, d) => s + d.revenue, 0)).toBe(2468);
    expect(series.reduce((s, d) => s + d.orders, 0)).toBe(2);
  });

  it("todo counts", async () => {
    const ctx = await createTenantContext();
    const p = await makeProduct(ctx.tenantId, { quantity: 5 });
    await makeOrder(ctx.tenantId, { lines: [{ product: p }], paymentStatus: "PAID" }); // to ship
    await makeOrder(ctx.tenantId, { lines: [{ product: p }] }); // bank transfer
    await makeOrder(ctx.tenantId, { lines: [{ product: p }], molliePaymentId: "tr_todo" }); // open Mollie
    await makeOrder(ctx.tenantId, { lines: [{ product: p }], paymentStatus: "FAILED" });
    await makeOrder(ctx.tenantId, { lines: [{ product: p }], paymentStatus: "EXPIRED", placedAt: daysAgo(10) }); // too old
    const p2 = await makeProduct(ctx.tenantId);
    await db.reservation.create({ data: { tenantId: ctx.tenantId, productId: p2.id, expiresAt: new Date(Date.now() + 60_000) } });
    const p3 = await makeProduct(ctx.tenantId);
    await db.reservation.create({ data: { tenantId: ctx.tenantId, productId: p3.id, expiresAt: new Date(Date.now() - 60_000) } }); // stale

    expect(await todoCounts(ctx)).toEqual({
      paidNotShipped: 1,
      pendingBankTransfers: 1,
      openPayments: 1,
      failedLast7Days: 1,
      activeReservations: 1,
    });
  });
});
