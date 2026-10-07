import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { makeOrder, makeProduct } from "../orders/test-fixtures";
import {
  allocatePurchaseRecordCost,
  createPurchaseRecord,
  createSupplier,
  deletePurchaseRecord,
  deleteSupplier,
  getPurchaseRecord,
  listPurchaseRecords,
  listSuppliers,
  marginReport,
  setPurchasePrices,
  updatePurchaseRecord,
  updateSupplier,
} from "./index";

const code = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e) => (e instanceof ServiceError ? e.code : String(e)),
  );

describe("purchasing", () => {
  beforeEach(resetDb);

  it("supplier CRUD with uniqueness and delete protection", async () => {
    const ctx = await createTenantContext();
    const s = await createSupplier(ctx, { name: "Veiling Hermann", contact: "info@hermann.test" });
    expect(await code(createSupplier(ctx, { name: "Veiling Hermann" }))).toBe("CONFLICT");
    await updateSupplier(ctx, s.id, { notes: "good lots" });
    const other = await createTenantContext();
    expect(await code(updateSupplier(other, s.id, { name: "x" }))).toBe("NOT_FOUND");
    expect(await listSuppliers(other)).toEqual([]);

    await createPurchaseRecord(ctx, { purchasedAt: "2026-09-01", supplierId: s.id });
    expect((await listSuppliers(ctx))[0]).toMatchObject({ name: "Veiling Hermann", notes: "good lots", purchaseRecordCount: 1 });
    expect(await code(deleteSupplier(ctx, s.id))).toBe("CONFLICT");
  });

  it("purchase records link products, allocate cost and back-fill order line snapshots", async () => {
    const ctx = await createTenantContext();
    const p1 = await makeProduct(ctx.tenantId, { price: 30000 });
    const p2 = await makeProduct(ctx.tenantId, { price: 10000 });
    const p3 = await makeProduct(ctx.tenantId, { price: 10000 });
    const other = await createTenantContext();
    const foreign = await makeProduct(other.tenantId);

    expect(await code(createPurchaseRecord(ctx, { purchasedAt: "2026-09-01", productIds: [p1.id, foreign.id] }))).toBe("NOT_FOUND");
    const rec = await createPurchaseRecord(ctx, { purchasedAt: "2026-09-01", totalCost: 10001, invoiceNumber: "INV-1", productIds: [p1.id, p2.id, p3.id] });

    // Sold before the cost was known → snapshot NULL; allocation back-fills it.
    const order = await makeOrder(ctx.tenantId, { lines: [{ product: p2 }], paymentStatus: "PAID" });
    const res = await allocatePurchaseRecordCost(ctx, rec.id, "byPrice");
    expect(res.orderLinesBackfilled).toBe(1);
    const detail = await getPurchaseRecord(ctx, rec.id);
    expect(detail.products.map((p) => p.purchasePrice)).toEqual([6001, 2000, 2000]);
    expect(detail.allocatedCost).toBe(10001);
    expect(detail.unallocatedCost).toBe(0);
    expect((await db.orderLine.findFirstOrThrow({ where: { orderId: order.id } })).purchasePriceSnapshot).toBe(2000);

    // Existing snapshots are never overwritten.
    await setPurchasePrices(ctx, { prices: [{ productId: p2.id, purchasePrice: 9999 }] });
    expect((await db.orderLine.findFirstOrThrow({ where: { orderId: order.id } })).purchasePriceSnapshot).toBe(2000);
    expect(await code(setPurchasePrices(other, { prices: [{ productId: p1.id, purchasePrice: 1 }] }))).toBe("NOT_FOUND");

    await updatePurchaseRecord(ctx, rec.id, { productIds: [p1.id] });
    expect((await getPurchaseRecord(ctx, rec.id)).products.map((p) => p.id)).toEqual([p1.id]);
    expect((await listPurchaseRecords(ctx, { search: "inv-1" })).items[0]).toMatchObject({ id: rec.id, productCount: 1 });
    expect(await code(getPurchaseRecord(other, rec.id))).toBe("NOT_FOUND");
    await deletePurchaseRecord(ctx, rec.id);
    expect((await db.product.findUniqueOrThrow({ where: { id: p1.id } })).purchaseRecordId).toBeNull();
  });

  it("margin report: PAID only, excl. shipping, grouped, with missing-cost lines", async () => {
    const ctx = await createTenantContext();
    const helmets = await db.category.create({ data: { tenantId: ctx.tenantId, title: "Helmets", slug: "helmets" } });
    const medals = await db.category.create({ data: { tenantId: ctx.tenantId, title: "Medals", slug: "medals" } });
    const sup = await createSupplier(ctx, { name: "Dealer A" });
    const rec = await createPurchaseRecord(ctx, { purchasedAt: "2026-08-01", supplierId: sup.id });

    const h = await makeProduct(ctx.tenantId, { price: 50000, purchasePrice: 30000, categoryId: helmets.id, purchaseRecordId: rec.id });
    const m1 = await makeProduct(ctx.tenantId, { price: 8000, purchasePrice: 2000, categoryId: medals.id, quantity: 5 });
    const m2 = await makeProduct(ctx.tenantId, { price: 4000, purchasePrice: null, categoryId: medals.id });

    const sept = new Date("2026-09-15T10:00:00Z");
    const oct = new Date("2026-10-02T10:00:00Z");
    await makeOrder(ctx.tenantId, { lines: [{ product: h }], paymentStatus: "PAID", placedAt: sept, shippingTotal: 1500 });
    await makeOrder(ctx.tenantId, { lines: [{ product: m1, quantity: 2 }, { product: m2 }], paymentStatus: "PAID", placedAt: oct });
    await makeOrder(ctx.tenantId, { lines: [{ product: h }], paymentStatus: "PENDING", placedAt: oct });
    await makeOrder(ctx.tenantId, { lines: [{ product: h }], paymentStatus: "PAID", placedAt: new Date("2026-06-01T10:00:00Z") }); // out of range

    const range = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z") };
    const byCat = await marginReport(ctx, { ...range, groupBy: "category" });
    expect(byCat.groups).toEqual([
      { key: helmets.id, label: "Helmets", lines: 1, revenue: 50000, costedRevenue: 50000, cost: 30000, margin: 20000, marginPct: 40, linesMissingCost: 0 },
      { key: medals.id, label: "Medals", lines: 2, revenue: 20000, costedRevenue: 16000, cost: 4000, margin: 12000, marginPct: 75, linesMissingCost: 1 },
    ]);
    expect(byCat.totals).toMatchObject({ lines: 3, revenue: 70000, costedRevenue: 66000, cost: 34000, margin: 32000, marginPct: 48.5, linesMissingCost: 1 });

    const bySup = await marginReport(ctx, { ...range, groupBy: "supplier" });
    expect(bySup.groups.map((g) => [g.label, g.revenue])).toEqual([
      ["Dealer A", 50000],
      ["Unknown supplier", 20000],
    ]);

    const byMonth = await marginReport(ctx, { ...range, groupBy: "month" });
    expect(byMonth.groups.map((g) => [g.key, g.revenue, g.cost])).toEqual([
      ["2026-09", 50000, 30000],
      ["2026-10", 20000, 4000],
    ]);

    const other = await createTenantContext();
    expect((await marginReport(other, { ...range, groupBy: "month" })).groups).toEqual([]);
  });
});
