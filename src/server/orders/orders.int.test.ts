import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import {
  addOrderNote,
  applyMolliePaymentStatus,
  archiveOrder,
  cancelOrder,
  finalizeOrder,
  markPaidManually,
  packingSlipData,
  setFulfillmentStatus,
  unarchiveOrder,
} from "./commands";
import { getOrder, listOrders } from "./queries";
import { makeOrder, makeProduct } from "./test-fixtures";

const code = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e) => (e instanceof ServiceError ? e.code : String(e)),
  );

describe("orders", () => {
  beforeEach(resetDb);

  describe("finalizeOrder", () => {
    it("is idempotent under concurrent duplicate calls", async () => {
      const ctx = await createTenantContext();
      const product = await makeProduct(ctx.tenantId, { quantity: 1 });
      const order = await makeOrder(ctx.tenantId, { lines: [{ product }], paymentStatus: "PAID", reserve: true });

      const results = await Promise.all(
        Array.from({ length: 6 }, () => finalizeOrder(ctx.tenantId, order.id, { source: "webhook" })),
      );
      expect(results.filter((r) => r.finalized)).toHaveLength(1);

      const p = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(p.quantity).toBe(0);
      expect(p.status).toBe("SOLD");
      expect(p.soldAt).not.toBeNull();
      const moves = await db.stockMovement.findMany({ where: { productId: product.id } });
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({ reason: "SALE", delta: -1, quantityAfter: 0, orderId: order.id });
      const res = await db.reservation.findMany({ where: { orderId: order.id } });
      expect(res.map((r) => r.status)).toEqual(["CONVERTED"]);
      const events = await db.orderEvent.findMany({ where: { orderId: order.id } });
      expect(events.filter((e) => e.type === "finalized")).toHaveLength(1);
      expect(events.filter((e) => e.type === "confirmation_queued")).toHaveLength(1);
    });

    it("decrements multi-quantity stock without marking SOLD while stock remains", async () => {
      const ctx = await createTenantContext();
      const product = await makeProduct(ctx.tenantId, { quantity: 3 });
      const order = await makeOrder(ctx.tenantId, { lines: [{ product, quantity: 2 }], paymentStatus: "PAID" });
      await finalizeOrder(ctx.tenantId, order.id, { source: "manual" });
      const p = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(p.quantity).toBe(1);
      expect(p.status).toBe("ACTIVE");
      expect(p.soldAt).toBeNull();
    });

    it("refuses unpaid orders and books oversold lines without failing", async () => {
      const ctx = await createTenantContext();
      const product = await makeProduct(ctx.tenantId, { quantity: 0 });
      const pending = await makeOrder(ctx.tenantId, { lines: [{ product }] });
      expect(await code(finalizeOrder(ctx.tenantId, pending.id, { source: "manual" }))).toBe("INVALID");

      const paid = await makeOrder(ctx.tenantId, { lines: [{ product }], paymentStatus: "PAID" });
      const r = await finalizeOrder(ctx.tenantId, paid.id, { source: "webhook" });
      expect(r.finalized).toBe(true);
      expect(r.oversold).toEqual([{ productId: product.id, ordered: 1, available: 0 }]);
      expect(await db.orderEvent.count({ where: { orderId: paid.id, type: "stock.oversold" } })).toBe(1);
    });

    it("releases another cart's hold when the product sells out", async () => {
      const ctx = await createTenantContext();
      const product = await makeProduct(ctx.tenantId, { quantity: 1 });
      const order = await makeOrder(ctx.tenantId, { lines: [{ product }], paymentStatus: "PAID" });
      // Our hold expired before payment; someone else grabbed the item.
      const other = await db.reservation.create({
        data: { tenantId: ctx.tenantId, productId: product.id, expiresAt: new Date(Date.now() + 60_000) },
      });
      await finalizeOrder(ctx.tenantId, order.id, { source: "webhook" });
      expect((await db.reservation.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("RELEASED");
    });
  });

  describe("applyMolliePaymentStatus", () => {
    it("keeps open/pending as PENDING (not failed) and finalizes once on paid", async () => {
      const ctx = await createTenantContext();
      const product = await makeProduct(ctx.tenantId, { quantity: 1 });
      const order = await makeOrder(ctx.tenantId, { lines: [{ product }], reserve: true, molliePaymentId: "tr_open1" });

      for (const s of ["open", "pending"]) {
        const r = await applyMolliePaymentStatus(ctx.tenantId, "tr_open1", s);
        expect(r.orderStatus).toBe("PENDING");
        const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
        expect(o.paymentStatus).toBe("PENDING");
        expect(await db.reservation.count({ where: { orderId: order.id, status: "ACTIVE" } })).toBe(1);
      }
      expect((await db.payment.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe("PENDING");

      const results = await Promise.all(
        Array.from({ length: 4 }, () => applyMolliePaymentStatus(ctx.tenantId, "tr_open1", "paid", { method: "ideal" })),
      );
      expect(results.filter((r) => r.finalized)).toHaveLength(1);
      const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(o.paymentStatus).toBe("PAID");
      expect(o.paidAt).not.toBeNull();
      expect(o.finalizedAt).not.toBeNull();
      expect(await db.stockMovement.count({ where: { orderId: order.id, reason: "SALE" } })).toBe(1);
      expect(await db.orderEvent.count({ where: { orderId: order.id, type: "payment.paid" } })).toBe(1);

      // A late non-paid webhook never downgrades a paid order.
      await applyMolliePaymentStatus(ctx.tenantId, "tr_open1", "expired");
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PAID");
    });

    it.each(["failed", "canceled", "expired"] as const)("%s → status + releases reservations, idempotently", async (status) => {
      const ctx = await createTenantContext();
      const product = await makeProduct(ctx.tenantId);
      const order = await makeOrder(ctx.tenantId, { lines: [{ product }], reserve: true, molliePaymentId: `tr_${status}` });
      const first = await applyMolliePaymentStatus(ctx.tenantId, `tr_${status}`, status);
      expect(first).toMatchObject({ orderStatus: status.toUpperCase(), changed: true, reservationsReleased: 1 });
      const again = await applyMolliePaymentStatus(ctx.tenantId, `tr_${status}`, status);
      expect(again).toMatchObject({ changed: false, reservationsReleased: 0 });
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(status.toUpperCase());
      expect(await db.reservation.count({ where: { orderId: order.id, status: "RELEASED" } })).toBe(1);
      expect(await db.orderEvent.count({ where: { orderId: order.id, type: `payment.${status}` } })).toBe(1);
    });

    it("ignores a late failure of an older attempt while a retry is open", async () => {
      const ctx = await createTenantContext();
      const product = await makeProduct(ctx.tenantId);
      const order = await makeOrder(ctx.tenantId, { lines: [{ product }], reserve: true, molliePaymentId: "tr_old" });
      await db.payment.create({
        data: { tenantId: ctx.tenantId, orderId: order.id, provider: "MOLLIE", providerPaymentId: "tr_new", amount: order.total, currency: "EUR", createdAt: new Date(Date.now() + 1000) },
      });
      await applyMolliePaymentStatus(ctx.tenantId, "tr_old", "expired");
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PENDING");
      expect(await db.reservation.count({ where: { orderId: order.id, status: "ACTIVE" } })).toBe(1);
    });

    it("is tenant-scoped and rejects unknown statuses", async () => {
      const a = await createTenantContext();
      const b = await createTenantContext();
      const product = await makeProduct(a.tenantId);
      await makeOrder(a.tenantId, { lines: [{ product }], molliePaymentId: "tr_a" });
      expect(await code(applyMolliePaymentStatus(b.tenantId, "tr_a", "paid"))).toBe("NOT_FOUND");
      expect(await code(applyMolliePaymentStatus(a.tenantId, "tr_a", "refunded"))).toBe("INVALID");
    });
  });

  describe("admin commands", () => {
    it("markPaidManually pays, finalizes and audits; second call conflicts", async () => {
      const ctx = await createTenantContext();
      const product = await makeProduct(ctx.tenantId);
      const order = await makeOrder(ctx.tenantId, { lines: [{ product }], reserve: true });
      const r = await markPaidManually(ctx, order.id, "Bank transfer received");
      expect(r.finalized).toBe(true);
      const o = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { payments: true } });
      expect(o.paymentStatus).toBe("PAID");
      expect(o.paidAt).not.toBeNull();
      expect(o.payments).toHaveLength(1);
      expect(o.payments[0]).toMatchObject({ provider: "MANUAL", status: "PAID", amount: order.total });
      expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe("SOLD");
      expect(await db.auditLog.count({ where: { action: "order.mark_paid", entityId: order.id } })).toBe(1);
      expect(await code(markPaidManually(ctx, order.id, null))).toBe("CONFLICT");
    });

    it("cancels only unpaid orders and releases reservations", async () => {
      const ctx = await createTenantContext();
      const product = await makeProduct(ctx.tenantId);
      const order = await makeOrder(ctx.tenantId, { lines: [{ product }], reserve: true });
      const r = await cancelOrder(ctx, order.id, "customer asked");
      expect(r.reservationsReleased).toBe(1);
      const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(o.paymentStatus).toBe("CANCELED");
      expect(o.canceledAt).not.toBeNull();
      expect(await code(cancelOrder(ctx, order.id))).toBe("CONFLICT");
      expect(await code(markPaidManually(ctx, order.id))).toBe("INVALID");

      const paid = await makeOrder(ctx.tenantId, { lines: [{ product }], paymentStatus: "PAID" });
      expect(await code(cancelOrder(ctx, paid.id))).toBe("CONFLICT");
    });

    it("archives/unarchives idempotently and never deletes", async () => {
      const ctx = await createTenantContext();
      const product = await makeProduct(ctx.tenantId);
      const order = await makeOrder(ctx.tenantId, { lines: [{ product }] });
      expect(await archiveOrder(ctx, order.id)).toEqual({ changed: true });
      expect(await archiveOrder(ctx, order.id)).toEqual({ changed: false });
      let list = await listOrders(ctx, { view: "archived" });
      expect(list.items.map((i) => i.id)).toEqual([order.id]);
      expect(list.counts.open).toBe(0);
      await unarchiveOrder(ctx, order.id);
      list = await listOrders(ctx, { view: "open" });
      expect(list.items.map((i) => i.id)).toEqual([order.id]);
      const commands = await import("./commands");
      expect(Object.keys(commands).some((k) => /delete|remove|destroy/i.test(k))).toBe(false);
    });

    it("fulfillment requires payment and records tracking", async () => {
      const ctx = await createTenantContext();
      const product = await makeProduct(ctx.tenantId);
      const pending = await makeOrder(ctx.tenantId, { lines: [{ product }] });
      expect(await code(setFulfillmentStatus(ctx, pending.id, { status: "SHIPPED" }))).toBe("INVALID");
      const paid = await makeOrder(ctx.tenantId, { lines: [{ product }], paymentStatus: "PAID" });
      await setFulfillmentStatus(ctx, paid.id, { status: "SHIPPED", carrier: "PostNL", trackingNumber: "3SABC123" });
      const o = await db.order.findUniqueOrThrow({ where: { id: paid.id } });
      expect(o).toMatchObject({ fulfillmentStatus: "SHIPPED", carrier: "PostNL", trackingNumber: "3SABC123" });
      expect(o.shippedAt).not.toBeNull();
      expect((await listOrders(ctx, { view: "shipped" })).items.map((i) => i.id)).toEqual([paid.id]);
    });
  });

  describe("queries", () => {
    it("lists by view with search and counts", async () => {
      const ctx = await createTenantContext();
      const product = await makeProduct(ctx.tenantId);
      const pending = await makeOrder(ctx.tenantId, { lines: [{ product }], email: "alice@example.test", name: "Alice Smit" });
      const paid = await makeOrder(ctx.tenantId, { lines: [{ product }], paymentStatus: "PAID", name: "Bob de Vries" });
      const failed = await makeOrder(ctx.tenantId, { lines: [{ product }], paymentStatus: "FAILED" });

      const open = await listOrders(ctx);
      expect(new Set(open.items.map((i) => i.id))).toEqual(new Set([pending.id, paid.id]));
      expect(open.counts).toMatchObject({ open: 2, toShip: 1, shipped: 0, failed: 1, archived: 0, all: 3 });
      expect((await listOrders(ctx, { view: "failed" })).items.map((i) => i.id)).toEqual([failed.id]);
      expect((await listOrders(ctx, { view: "all", search: "ALICE" })).items.map((i) => i.id)).toEqual([pending.id]);
      expect((await listOrders(ctx, { view: "all", search: "vries" })).items.map((i) => i.id)).toEqual([paid.id]);
      expect((await listOrders(ctx, { view: "all", search: `#${failed.number}` })).items.map((i) => i.id)).toEqual([failed.id]);
      const future = new Date(Date.now() + 86_400_000);
      expect((await listOrders(ctx, { view: "all", from: future })).total).toBe(0);
    });

    it("getOrder returns detail with event actors and customer summary", async () => {
      const ctx = await createTenantContext();
      const product = await makeProduct(ctx.tenantId);
      const customer = await db.customer.create({ data: { tenantId: ctx.tenantId, email: "c@example.test", firstName: "Cor" } });
      const order = await makeOrder(ctx.tenantId, { lines: [{ product }], customerId: customer.id });
      await makeOrder(ctx.tenantId, { lines: [{ product }], customerId: customer.id });
      await addOrderNote(ctx, order.id, "Called the customer");

      const byId = await getOrder(ctx, order.id);
      const byNumber = await getOrder(ctx, { number: order.number });
      expect(byNumber.id).toBe(byId.id);
      expect(byId.lines).toHaveLength(1);
      expect(byId.shippingAddress?.city).toBe("Utrecht");
      expect(byId.events).toEqual([expect.objectContaining({ type: "note", actor: { id: ctx.actor.id, name: ctx.actor.email } })]);
      expect(byId.customer).toMatchObject({ id: customer.id, orderCount: 2, paidOrderCount: 0, registered: false });
    });

    it("packing slip data respects the price setting", async () => {
      const ctx = await createTenantContext();
      const product = await makeProduct(ctx.tenantId, { price: 2500 });
      const order = await makeOrder(ctx.tenantId, { lines: [{ product, quantity: 2 }], paymentStatus: "PAID" });
      const slip = await packingSlipData(ctx, order.id);
      expect(slip.itemCount).toBe(2);
      expect(slip.lines[0]).toMatchObject({ quantity: 2, unitPrice: 2500, lineTotal: 5000 });
      expect(slip.totals).toMatchObject({ subtotal: 5000, shipping: 695, total: 5695 });
      expect(slip.shippingAddress?.countryCode).toBe("NL");
    });
  });

  it("never exposes or mutates another tenant's orders (NOT_FOUND)", async () => {
    const a = await createTenantContext();
    const b = await createTenantContext();
    const product = await makeProduct(a.tenantId);
    const order = await makeOrder(a.tenantId, { lines: [{ product }], reserve: true });

    expect(await code(getOrder(b, order.id))).toBe("NOT_FOUND");
    expect(await code(getOrder(b, { number: order.number }))).toBe("NOT_FOUND");
    expect(await code(markPaidManually(b, order.id))).toBe("NOT_FOUND");
    expect(await code(cancelOrder(b, order.id))).toBe("NOT_FOUND");
    expect(await code(archiveOrder(b, order.id))).toBe("NOT_FOUND");
    expect(await code(addOrderNote(b, order.id, "x"))).toBe("NOT_FOUND");
    expect(await code(setFulfillmentStatus(b, order.id, { status: "PACKED" }))).toBe("NOT_FOUND");
    expect(await code(packingSlipData(b, order.id))).toBe("NOT_FOUND");
    expect(await code(finalizeOrder(b.tenantId, order.id, { source: "manual" }))).toBe("NOT_FOUND");
    expect((await listOrders(b, { view: "all" })).total).toBe(0);

    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o).toMatchObject({ paymentStatus: "PENDING", archivedAt: null, canceledAt: null });
  });
});
