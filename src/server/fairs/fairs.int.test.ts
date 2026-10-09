import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import { markPaidManually } from "@/server/orders/commands";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { makeOrder, makeProduct } from "../orders/test-fixtures";
import { addFairItems, createFair, endFair, getFairReport, recordFairSale, startFair } from "./index";

const code = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e) => (e instanceof ServiceError ? e.code : String(e)),
  );

async function liveFair(hideFromShop = true) {
  const ctx = await createTenantContext();
  const product = await makeProduct(ctx.tenantId, { price: 145000, purchasePrice: 88000 });
  const fair = await createFair(ctx, { name: "Militaria Börse", startsOn: "2026-10-12", hideFromShop });
  await addFairItems(ctx, fair.id, [product.id]);
  await startFair(ctx, fair.id);
  return { ctx, product, fair };
}

describe("fairs", () => {
  beforeEach(resetDb);

  it("holds items while live and releases them when the fair ends", async () => {
    const { ctx, product, fair } = await liveFair();
    const item = await db.fairItem.findFirstOrThrow({ where: { fairId: fair.id } });
    expect(item.floorPrice).toBe(125000); // list −15%, rounded to €50
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).fairHoldId).toBe(fair.id);

    expect(await endFair(ctx, fair.id)).toEqual({ released: 1 });
    const after = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.fairHoldId).toBeNull();
    expect(after.status).toBe("ACTIVE");
  });

  it("records a card sale as a finalized FAIR order in one go", async () => {
    const { ctx, product, fair } = await liveFair();
    const sale = await recordFairSale(ctx, { fairId: fair.id, productId: product.id, price: 135000, method: "card", clientRef: "ref-card-0001" });
    expect(sale).toMatchObject({ paymentStatus: "PAID", reused: false });

    const order = await db.order.findUniqueOrThrow({ where: { id: sale.orderId }, include: { lines: true, payments: true } });
    expect(order).toMatchObject({ channel: "FAIR", fairId: fair.id, clientRef: "ref-card-0001", total: 135000, paymentMethod: "card", shippingMethod: "PICKUP", fulfillmentStatus: "DELIVERED" });
    expect(order.finalizedAt).not.toBeNull();
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({ unitPrice: 135000, purchasePriceSnapshot: 88000 });
    expect(order.payments.map((p) => [p.provider, p.status])).toEqual([["MANUAL", "PAID"]]);

    const p = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(p).toMatchObject({ status: "SOLD", quantity: 0, fairHoldId: null });
    expect(await db.stockMovement.count({ where: { productId: product.id, reason: "SALE", orderId: order.id } })).toBe(1);
    const item = await db.fairItem.findFirstOrThrow({ where: { fairId: fair.id } });
    expect(item).toMatchObject({ soldPrice: 135000, orderId: order.id });

    const report = await getFairReport(ctx, fair.id);
    expect(report).toMatchObject({ count: 1, revenue: 135000, margin: 47000, cashExpected: 0, unsold: 0 });
  });

  it("is idempotent on clientRef, also for concurrent deliveries", async () => {
    const { ctx, product, fair } = await liveFair();
    const input = { fairId: fair.id, productId: product.id, price: 140000, method: "cash" as const, clientRef: "ref-retry-0001" };
    const results = await Promise.all([recordFairSale(ctx, input), recordFairSale(ctx, input), recordFairSale(ctx, input)]);
    expect(new Set(results.map((r) => r.orderId)).size).toBe(1);
    expect(results.filter((r) => !r.reused)).toHaveLength(1);
    const again = await recordFairSale(ctx, input);
    expect(again).toMatchObject({ orderId: results[0].orderId, reused: true });
    expect(await db.order.count({ where: { fairId: fair.id } })).toBe(1);
    expect(await db.stockMovement.count({ where: { productId: product.id, reason: "SALE" } })).toBe(1);
  });

  it("rejects a second sale of the same item and a web-reserved item", async () => {
    const { ctx, product, fair } = await liveFair();
    await recordFairSale(ctx, { fairId: fair.id, productId: product.id, price: 140000, method: "cash", clientRef: "ref-first-0001" });
    expect(await code(recordFairSale(ctx, { fairId: fair.id, productId: product.id, price: 140000, method: "card", clientRef: "ref-second-001" }))).toBe("CONFLICT");

    const other = await makeProduct(ctx.tenantId, { price: 10000 });
    await addFairItems(ctx, fair.id, [other.id]);
    // A webshop order awaiting payment holds the item.
    await db.product.update({ where: { id: other.id }, data: { fairHoldId: null } });
    await makeOrder(ctx.tenantId, { lines: [{ product: other }], reserve: true });
    expect(await code(recordFairSale(ctx, { fairId: fair.id, productId: other.id, price: 10000, method: "cash", clientRef: "ref-web-00001" }))).toBe("CONFLICT");
  });

  it("enforces the floor unless overridden", async () => {
    const { ctx, product, fair } = await liveFair();
    const low = { fairId: fair.id, productId: product.id, price: 100000, method: "card" as const, clientRef: "ref-low-00001" };
    expect(await code(recordFairSale(ctx, low))).toBe("INVALID");
    expect(await code(recordFairSale(ctx, { ...low, allowBelowFloor: true }))).toBe("OK");
  });

  it("books an invoice sale out now and finalizes it on payment without double booking", async () => {
    const { ctx, product, fair } = await liveFair();
    const sale = await recordFairSale(ctx, {
      fairId: fair.id,
      productId: product.id,
      price: 145000,
      method: "invoice",
      buyerEmail: "Buyer@Example.com",
      buyerName: "Hans Beispiel",
      clientRef: "ref-invoice-01",
    });
    expect(sale.paymentStatus).toBe("PENDING");
    const order = await db.order.findUniqueOrThrow({ where: { id: sale.orderId } });
    expect(order).toMatchObject({ email: "buyer@example.com", customerName: "Hans Beispiel", finalizedAt: null });
    expect(order.customerId).not.toBeNull();
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe("SOLD");

    const fin = await markPaidManually(ctx, sale.orderId);
    expect(fin).toMatchObject({ finalized: true, oversold: [] });
    expect(await db.stockMovement.count({ where: { productId: product.id, reason: "SALE" } })).toBe(1);
    expect(await db.orderEvent.count({ where: { orderId: sale.orderId, type: "stock.oversold" } })).toBe(0);
  });

  it("refuses sales before the fair starts and for items not on the fair", async () => {
    const ctx = await createTenantContext();
    const product = await makeProduct(ctx.tenantId);
    const fair = await createFair(ctx, { name: "Preparing", startsOn: "2026-10-12" });
    await addFairItems(ctx, fair.id, [product.id]);
    expect(await code(recordFairSale(ctx, { fairId: fair.id, productId: product.id, price: 10000, method: "cash", clientRef: "ref-prep-0001" }))).toBe("CONFLICT");
    await startFair(ctx, fair.id);
    const stranger = await makeProduct(ctx.tenantId);
    expect(await code(recordFairSale(ctx, { fairId: fair.id, productId: stranger.id, price: 10000, method: "cash", clientRef: "ref-none-0001" }))).toBe("NOT_FOUND");
  });
});
