import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { makeOrder, makeProduct } from "@/server/orders/test-fixtures";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { installHarness } from "../../../tests/integration/mail-harness";
import { getShippingBoard, packingSlipsData, queueShippedMailOnce, SHIPPED_MAIL_EVENT, updateFulfillment } from "./index";

let h: ReturnType<typeof installHarness>;
beforeEach(async () => {
  await resetDb();
  h = installHarness();
  process.env.MAIL_FROM_FALLBACK = "no-reply@quartermaster.test";
});
afterEach(() => h.uninstall());

const shippedMails = () => h.jobs.filter((j) => j.name === "mail.send" && (j.data as { template: string }).template === "order-shipped");

async function paidOrder(tenantId: string) {
  const product = await makeProduct(tenantId, { title: "Koppelschloss" });
  return makeOrder(tenantId, { lines: [{ product }], paymentStatus: "PAID", email: "buyer@example.test", name: "Jan Jansen" });
}

describe("fulfillment shipped mail", () => {
  it("queues exactly one mail per shipment under concurrent duplicate requests", async () => {
    const ctx = await createTenantContext();
    const order = await paidOrder(ctx.tenantId);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => updateFulfillment(ctx, order.id, { status: "SHIPPED", carrier: "PostNL", trackingNumber: "3SABC123" })),
    );
    expect(results.filter((r) => r.mailQueued)).toHaveLength(1);
    expect(shippedMails()).toHaveLength(1);
    expect(shippedMails()[0].options.inTransaction).toBe(true);
    // The carrier preset filled in the tracking link (PostNL needs country + postcode).
    const saved = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved.trackingUrl).toBe("https://jouw.postnl.nl/track-and-trace/3SABC123-NL-1234AB");
    // Re-running the claim is a no-op.
    expect(await queueShippedMailOnce(ctx.tenantId, order.id)).toBe(false);
    expect(await db.orderEvent.count({ where: { orderId: order.id, type: SHIPPED_MAIL_EVENT } })).toBe(1);
  });

  it("re-saving tracking is not a new shipment; a new transition into SHIPPED is", async () => {
    const ctx = await createTenantContext();
    const order = await paidOrder(ctx.tenantId);
    await updateFulfillment(ctx, order.id, { status: "SHIPPED", carrier: "DHL", trackingNumber: "1" });
    await updateFulfillment(ctx, order.id, { status: "SHIPPED", carrier: "DHL", trackingNumber: "2" });
    expect(shippedMails()).toHaveLength(1);
    await updateFulfillment(ctx, order.id, { status: "PACKED" });
    await updateFulfillment(ctx, order.id, { status: "SHIPPED", carrier: "DHL", trackingNumber: "3" });
    expect(shippedMails()).toHaveLength(2);
  });

  it("respects notifyCustomer=false and can still notify later for the same shipment (once)", async () => {
    const ctx = await createTenantContext();
    const order = await paidOrder(ctx.tenantId);
    const r1 = await updateFulfillment(ctx, order.id, { status: "SHIPPED", notifyCustomer: false });
    expect(r1.mailQueued).toBe(false);
    expect(shippedMails()).toHaveLength(0);
    const r2 = await updateFulfillment(ctx, order.id, { status: "SHIPPED", trackingNumber: "X1", notifyCustomer: true });
    expect(r2.mailQueued).toBe(true);
    const r3 = await updateFulfillment(ctx, order.id, { status: "SHIPPED", trackingNumber: "X1", notifyCustomer: true });
    expect(r3.mailQueued).toBe(false);
    expect(shippedMails()).toHaveLength(1);
  });

  it("renders the shipped mail with the tracking link, and skips it once the order is no longer shipped", async () => {
    const ctx = await createTenantContext();
    const order = await paidOrder(ctx.tenantId);
    await updateFulfillment(ctx, order.id, { status: "SHIPPED", carrier: "UPS", trackingNumber: "1Z999" });
    await h.drain();
    expect(h.mails).toHaveLength(1);
    expect(h.mails[0].to).toBe("buyer@example.test");
    expect(String(h.mails[0].subject)).toContain(`#${order.number}`);
    expect(String(h.mails[0].html)).toContain("https://www.ups.com/track?loc=en_NL&amp;tracknum=1Z999");

    const other = await paidOrder(ctx.tenantId);
    await updateFulfillment(ctx, other.id, { status: "SHIPPED" });
    await updateFulfillment(ctx, other.id, { status: "UNFULFILLED" });
    await h.drain();
    expect(h.mails).toHaveLength(1); // skipped: reset before the job ran
  });

  it("does not move unpaid orders and never mails for them", async () => {
    const ctx = await createTenantContext();
    const order = await makeOrder(ctx.tenantId, { lines: [{ product: await makeProduct(ctx.tenantId) }] });
    await expect(updateFulfillment(ctx, order.id, { status: "SHIPPED" })).rejects.toMatchObject({ code: "INVALID" });
    expect(shippedMails()).toHaveLength(0);
  });
});

describe("shipping board", () => {
  it("splits orders into lanes, tenant-scoped, shipped lane limited to 14 days", async () => {
    const ctx = await createTenantContext();
    const other = await createTenantContext();
    const product = await makeProduct(ctx.tenantId);
    const pending = await makeOrder(ctx.tenantId, { lines: [{ product }] });
    const toPack = await makeOrder(ctx.tenantId, { lines: [{ product }], paymentStatus: "PAID" });
    const packed = await makeOrder(ctx.tenantId, { lines: [{ product }], paymentStatus: "PAID" });
    const shipped = await makeOrder(ctx.tenantId, { lines: [{ product }], paymentStatus: "PAID" });
    const oldShipped = await makeOrder(ctx.tenantId, { lines: [{ product }], paymentStatus: "PAID" });
    await makeOrder(other.tenantId, { lines: [{ product: await makeProduct(other.tenantId) }], paymentStatus: "PAID" });
    await updateFulfillment(ctx, packed.id, { status: "PACKED" });
    await updateFulfillment(ctx, shipped.id, { status: "SHIPPED", notifyCustomer: false });
    await db.order.update({
      where: { id: oldShipped.id },
      data: { fulfillmentStatus: "SHIPPED", shippedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) },
    });

    const board = await getShippingBoard(ctx);
    expect(board.awaiting.cards.map((c) => c.id)).toEqual([pending.id]);
    expect(board.toPack.cards.map((c) => c.id)).toEqual([toPack.id]);
    expect(board.packed.cards.map((c) => c.id)).toEqual([packed.id]);
    expect(board.shipped.cards.map((c) => c.id)).toEqual([shipped.id]);
    expect(board.toPack.cards[0].shipTo).toMatchObject({ countryCode: "NL", postalCode: "1234AB" });

    // Bulk packing slips skip other tenants' ids.
    const otherOrder = await db.order.findFirstOrThrow({ where: { tenantId: other.tenantId } });
    const slips = await packingSlipsData(ctx, [toPack.id, otherOrder.id, packed.id, "nope"]);
    expect(slips.map((s) => s.order.number)).toEqual([toPack.number, packed.number]);
  });
});
