import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import { runJobNow } from "@/server/jobs/queue";
import { setStorageForTests, type StorageDriver, type StoredObject } from "@/server/media/storage";
import { makeOrder, makeProduct } from "@/server/orders/test-fixtures";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { installHarness } from "../../../tests/integration/mail-harness";
import { formatInvoiceNumber, issueInvoice, onOrderFinalized } from "./index";
import { ensureInvoicePdf } from "./pdf-store";

/** In-memory storage so the PDF test doesn't touch the uploads directory. */
function memoryStorage(): StorageDriver & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const info = (b: Uint8Array) => ({ size: b.byteLength, contentType: "application/pdf", lastModified: new Date(), etag: '"x"' });
  return {
    files,
    async put(key, body) {
      files.set(key, body);
    },
    async head(key) {
      const b = files.get(key);
      return b ? info(b) : null;
    },
    async get(key) {
      const b = files.get(key);
      if (!b) return null;
      return { ...info(b), body: new Blob([new Uint8Array(b)]).stream() } as StoredObject;
    },
    async exists(key) {
      return files.has(key);
    },
    async delete(key) {
      files.delete(key);
    },
    async deletePrefix() {},
  };
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e) => (e instanceof ServiceError ? e.code : String(e)),
  );

let h: ReturnType<typeof installHarness>;
beforeEach(async () => {
  await resetDb();
  h = installHarness();
});
afterEach(() => {
  h.uninstall();
  setStorageForTests(null);
});

describe("invoices", () => {
  it("only invoices PAID orders", async () => {
    const ctx = await createTenantContext();
    const product = await makeProduct(ctx.tenantId);
    for (const status of ["PENDING", "FAILED", "CANCELED", "EXPIRED", "REFUNDED"] as const) {
      const order = await makeOrder(ctx.tenantId, { lines: [{ product }], paymentStatus: status });
      expect(await code(issueInvoice(ctx, order.id))).toBe("INVALID");
    }
    expect(await db.invoice.count()).toBe(0);
    // No number was consumed by the failed attempts.
    expect(await db.tenantSequence.findFirst({ where: { tenantId: ctx.tenantId, name: "invoice.number" } })).toBeNull();
  });

  it("numbers invoices gaplessly per tenant under concurrency, one invoice per order", async () => {
    const a = await createTenantContext();
    const b = await createTenantContext();
    const product = await makeProduct(a.tenantId);
    const ordersA = await Promise.all(Array.from({ length: 8 }, () => makeOrder(a.tenantId, { lines: [{ product }], paymentStatus: "PAID" })));
    const productB = await makeProduct(b.tenantId);
    const ordersB = await Promise.all(Array.from({ length: 3 }, () => makeOrder(b.tenantId, { lines: [{ product: productB }], paymentStatus: "PAID" })));

    // Every order issued twice at once (double click / job + admin), all concurrently.
    const results = await Promise.all([
      ...ordersA.flatMap((o) => [issueInvoice(a, o.id), issueInvoice(a, o.id)]),
      ...ordersB.map((o) => issueInvoice(b, o.id)),
    ]);
    expect(results.filter((r) => r.created)).toHaveLength(ordersA.length + ordersB.length);

    const invA = await db.invoice.findMany({ where: { tenantId: a.tenantId }, orderBy: { number: "asc" } });
    expect(invA.map((i) => i.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(invA.map((i) => i.orderId)).size).toBe(8);
    expect(invA.every((i) => i.vatScheme === "MARGIN")).toBe(true);
    const invB = await db.invoice.findMany({ where: { tenantId: b.tenantId }, orderBy: { number: "asc" } });
    expect(invB.map((i) => i.number)).toEqual([1, 2, 3]);

    // A repeated issue returns the existing invoice.
    const again = await issueInvoice(a, ordersA[0].id);
    expect(again.created).toBe(false);
    expect(again.invoice?.id).toBe(invA.find((i) => i.orderId === ordersA[0].id)?.id);
  });

  it("is tenant-scoped", async () => {
    const a = await createTenantContext();
    const b = await createTenantContext();
    const order = await makeOrder(a.tenantId, { lines: [{ product: await makeProduct(a.tenantId) }], paymentStatus: "PAID" });
    expect(await code(issueInvoice(b, order.id))).toBe("NOT_FOUND");
  });

  it("snapshots totals, writes an event and queues the PDF render; the auto-issue hook goes through a job", async () => {
    const ctx = await createTenantContext();
    const order = await makeOrder(ctx.tenantId, { lines: [{ product: await makeProduct(ctx.tenantId, { price: 12500 }) }], paymentStatus: "PAID" });
    await onOrderFinalized(ctx.tenantId, order.id);
    expect(h.jobs.map((j) => j.name)).toEqual(["invoices.issue"]);
    await h.drain((j) => j.name === "invoices.issue");
    const invoice = await db.invoice.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(invoice).toMatchObject({ number: 1, total: order.total, currency: "EUR" });
    expect(await db.orderEvent.count({ where: { orderId: order.id, type: "invoice.issued" } })).toBe(1);
    expect(h.jobs.map((j) => j.name)).toEqual(["invoices.render"]);

    // Unpaid orders are skipped by the job instead of failing it.
    const pending = await makeOrder(ctx.tenantId, { lines: [{ product: await makeProduct(ctx.tenantId) }] });
    expect(await runJobNow("invoices.issue", { tenantId: ctx.tenantId, orderId: pending.id })).toMatchObject({ created: false, skipped: "not_paid" });
  });

  it("renders the PDF once and stores it", async () => {
    const storage = memoryStorage();
    setStorageForTests(storage);
    const ctx = await createTenantContext();
    const order = await makeOrder(ctx.tenantId, { lines: [{ product: await makeProduct(ctx.tenantId, { title: "Stahlhelm M40" }) }], paymentStatus: "PAID" });
    const { invoice } = await issueInvoice(ctx, order.id);
    const first = await ensureInvoicePdf(ctx.tenantId, invoice!.id);
    expect(first.rendered).toBe(true);
    const bytes = storage.files.get(first.storageKey)!;
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const second = await ensureInvoicePdf(ctx.tenantId, invoice!.id);
    expect(second).toEqual({ storageKey: first.storageKey, rendered: false });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice!.id } })).storageKey).toBe(`${ctx.tenantId}/invoices/${invoice!.id}.pdf`);
    expect(formatInvoiceNumber(invoice!.number, invoice!.issuedAt)).toMatch(/^INV-\d{4}-000001$/);
  });
});
