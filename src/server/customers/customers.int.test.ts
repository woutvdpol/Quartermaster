import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { makeOrder, makeProduct } from "../orders/test-fixtures";
import { anonymizeCustomer, findOrCreateGuestCustomer, getCustomer, listCustomers, updateCustomer } from "./index";

const code = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e) => (e instanceof ServiceError ? e.code : String(e)),
  );

describe("customers", () => {
  beforeEach(resetDb);

  it("findOrCreateGuestCustomer is race-safe and only fills empty fields", async () => {
    const ctx = await createTenantContext();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        db.$transaction((tx) => findOrCreateGuestCustomer(tx, ctx.tenantId, { email: " Piet@Example.TEST ", name: "Piet van Dam" })),
      ),
    );
    expect(new Set(results.map((c) => c.id)).size).toBe(1);
    expect(results[0]).toMatchObject({ email: "piet@example.test", firstName: "Piet", lastName: "van Dam" });
    const again = await db.$transaction((tx) =>
      findOrCreateGuestCustomer(tx, ctx.tenantId, { email: "piet@example.test", name: "Other Name", phone: "0612345678" }),
    );
    expect(again).toMatchObject({ firstName: "Piet", lastName: "van Dam", phone: "0612345678" });
  });

  it("lists with totals (paid revenue excludes unpaid) sorted by last order, and searches", async () => {
    const ctx = await createTenantContext();
    const p = await makeProduct(ctx.tenantId, { price: 1000, quantity: 10 });
    const a = await db.customer.create({ data: { tenantId: ctx.tenantId, email: "a@x.test", firstName: "Anna", lastName: "Bakker" } });
    const b = await db.customer.create({ data: { tenantId: ctx.tenantId, email: "b@x.test", firstName: "Bert" } });
    await db.customer.create({ data: { tenantId: ctx.tenantId, email: "c@x.test" } });
    await makeOrder(ctx.tenantId, { lines: [{ product: p }], customerId: a.id, paymentStatus: "PAID", placedAt: new Date(Date.now() - 5 * 86_400_000), shippingTotal: 500 });
    await makeOrder(ctx.tenantId, { lines: [{ product: p }], customerId: a.id, paymentStatus: "FAILED", placedAt: new Date(Date.now() - 4 * 86_400_000) });
    await makeOrder(ctx.tenantId, { lines: [{ product: p }], customerId: b.id, paymentStatus: "PENDING" });

    const list = await listCustomers(ctx);
    expect(list.total).toBe(3);
    expect(list.items.map((c) => c.email)).toEqual(["b@x.test", "a@x.test", "c@x.test"]);
    expect(list.items[1]).toMatchObject({ orderCount: 2, paidOrderCount: 1, paidRevenue: 1500, name: "Anna Bakker" });
    expect(list.items[0]).toMatchObject({ orderCount: 1, paidRevenue: 0 });

    expect((await listCustomers(ctx, { sort: "revenue" })).items[0].email).toBe("a@x.test");
    expect((await listCustomers(ctx, { search: "bakker" })).items.map((c) => c.id)).toEqual([a.id]);
    expect((await listCustomers(ctx, { search: "100%" })).total).toBe(0);
    const other = await createTenantContext();
    expect((await listCustomers(other)).total).toBe(0);
  });

  it("getCustomer / updateCustomer are tenant-scoped; email conflicts are reported", async () => {
    const ctx = await createTenantContext();
    const other = await createTenantContext();
    const c = await db.customer.create({ data: { tenantId: ctx.tenantId, email: "a@x.test" } });
    await db.customer.create({ data: { tenantId: ctx.tenantId, email: "taken@x.test" } });
    const p = await makeProduct(ctx.tenantId);
    await db.wishlistItem.create({ data: { tenantId: ctx.tenantId, customerId: c.id, productId: p.id } });

    const detail = await getCustomer(ctx, c.id);
    expect(detail).toMatchObject({ wishlistCount: 1, orderCount: 0, registered: false, anonymized: false });
    expect(await code(getCustomer(other, c.id))).toBe("NOT_FOUND");
    expect(await code(updateCustomer(other, c.id, { firstName: "X" }))).toBe("NOT_FOUND");
    expect(await code(updateCustomer(ctx, c.id, { email: "TAKEN@x.test" }))).toBe("CONFLICT");
    const updated = await updateCustomer(ctx, c.id, { firstName: "Ada", phone: "" });
    expect(updated).toMatchObject({ firstName: "Ada", phone: null });
  });

  it("anonymizeCustomer keeps orders and amounts but scrubs PII", async () => {
    const ctx = await createTenantContext();
    const p = await makeProduct(ctx.tenantId, { price: 4200 });
    const c = await db.customer.create({
      data: { tenantId: ctx.tenantId, email: "jan@x.test", firstName: "Jan", lastName: "Jansen", phone: "0611111111", notes: "VIP" },
    });
    await db.address.create({
      data: { tenantId: ctx.tenantId, customerId: c.id, firstName: "Jan", lastName: "Jansen", street: "Dorpsstraat", city: "Ede", countryCode: "NL" },
    });
    await db.newsletterSubscriber.create({ data: { tenantId: ctx.tenantId, email: "jan@x.test", customerId: c.id } });
    const linked = await makeOrder(ctx.tenantId, { lines: [{ product: p }], customerId: c.id, email: "jan@x.test", name: "Jan Jansen", paymentStatus: "PAID", molliePaymentId: "tr_pii" });
    await db.payment.updateMany({ where: { orderId: linked.id }, data: { raw: { details: { consumerName: "J. Jansen", consumerAccount: "NL00BANK0123456789" } } } });
    const guest = await makeOrder(ctx.tenantId, { lines: [{ product: p }], email: "jan@x.test", name: "Jan J." });
    const unrelated = await makeOrder(ctx.tenantId, { lines: [{ product: p }], email: "someone@x.test", name: "Someone" });

    const r = await anonymizeCustomer(ctx, c.id);
    expect(r).toMatchObject({ alreadyAnonymized: false, orders: 2 });

    const cust = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(cust).toMatchObject({ firstName: null, lastName: null, phone: null, notes: null, userId: null });
    expect(cust.email).toMatch(/@anonymized\.invalid$/);
    expect(await db.address.count({ where: { customerId: c.id } })).toBe(0);
    expect(await db.newsletterSubscriber.count({ where: { tenantId: ctx.tenantId } })).toBe(0);

    const orders = await db.order.findMany({ where: { id: { in: [linked.id, guest.id] } }, include: { addresses: true, payments: true, lines: true } });
    expect(orders).toHaveLength(2);
    for (const o of orders) {
      expect(o.customerId).toBe(c.id);
      expect(o.email).toBe(cust.email);
      // Name and address stay on orders for fiscal retention; contact details are removed.
      expect(o.customerName).not.toBe("Anonymized customer");
      expect(o.phone).toBeNull();
      expect(o.addresses[0].street).not.toBe("-");
      expect(o.addresses[0]).toMatchObject({ phone: null, countryCode: "NL" });
      expect(o.lines[0].lineTotal).toBe(4200);
      for (const pay of o.payments) expect(pay.raw).toBeNull();
    }
    expect(orders.find((o) => o.id === linked.id)!.paymentStatus).toBe("PAID");
    expect((await db.order.findUniqueOrThrow({ where: { id: unrelated.id } })).customerName).toBe("Someone");
    expect(await db.orderEvent.count({ where: { type: "customer.anonymized" } })).toBe(2);

    expect((await anonymizeCustomer(ctx, c.id)).alreadyAnonymized).toBe(true);
    const other = await createTenantContext();
    expect(await code(anonymizeCustomer(other, c.id))).toBe("NOT_FOUND");
  });
});
