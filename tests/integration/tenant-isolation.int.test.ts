import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { setJobTransportForTests } from "@/server/jobs/queue";
import { createProduct, deleteProduct, getProduct, updateProduct, listProducts } from "@/server/catalog/products";
import { addOrderNote, cancelOrder } from "@/server/orders/commands";
import { getOrder, listOrders } from "@/server/orders/queries";
import { anonymizeCustomer, getCustomer, listCustomers, updateCustomer } from "@/server/customers";
import { createPage, deletePage, getPage, listPages, updatePage } from "@/server/content/pages";
import { createRedirect, deleteRedirect, getRedirect, listRedirects, updateRedirect } from "@/server/redirects";
import { tenantDb, TenantScopeError } from "@/server/tenant-scope";
import { makeOrder, makeProduct } from "@/server/orders/test-fixtures";
import { createTenantContext, resetDb } from "./helpers";

/*
 * Security backlog #11: a staff context of tenant A must never read or change tenant B's data —
 * neither through the main services (layer 1: explicit tenantId filters) nor through the
 * tenant-scoped client (layer 2: src/server/tenant-scope.ts).
 */

async function rejects(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "expected the cross-tenant call to fail").toBeTruthy();
  // NOT_FOUND (never FORBIDDEN): another tenant's ids must be indistinguishable from unknown ids.
  expect((err as { code?: string }).code ?? (err as Error).name).toMatch(/NOT_FOUND|P2025|TenantScopeError/);
}

let a: ServiceContext;
let b: ServiceContext;

beforeEach(async () => {
  await resetDb();
  setJobTransportForTests(() => {});
  a = await createTenantContext();
  b = await createTenantContext();
});
afterEach(() => setJobTransportForTests(null));

describe("services: cross-tenant access fails", () => {
  it("products", async () => {
    const pb = await createProduct(b, { title: "B's helmet", price: 1000 });
    await rejects(getProduct(a, pb.id));
    await rejects(getProduct(a, { stockCode: pb.stockCode }));
    await rejects(updateProduct(a, pb.id, { title: "pwned" }));
    await rejects(deleteProduct(a, pb.id));
    expect((await listProducts(a)).rows.map((p) => p.id)).not.toContain(pb.id);
    expect((await db.product.findUniqueOrThrow({ where: { id: pb.id } })).title).toBe("B's helmet");
  });

  it("orders", async () => {
    const product = await makeProduct(b.tenantId);
    const ob = await makeOrder(b.tenantId, { lines: [{ product }] });
    await rejects(getOrder(a, ob.id));
    await rejects(getOrder(a, { number: ob.number }));
    await rejects(addOrderNote(a, ob.id, "pwned"));
    await rejects(cancelOrder(a, ob.id, "pwned"));
    expect((await listOrders(a)).items).toHaveLength(0);
    const after = await db.order.findUniqueOrThrow({ where: { id: ob.id } });
    expect([after.paymentStatus, after.notes]).toEqual([ob.paymentStatus, ob.notes]);
  });

  it("customers", async () => {
    const cb = await db.customer.create({ data: { tenantId: b.tenantId, email: "jan@example.test", firstName: "Jan" } });
    await rejects(getCustomer(a, cb.id));
    await rejects(updateCustomer(a, cb.id, { firstName: "pwned" }));
    await rejects(anonymizeCustomer(a, cb.id));
    expect((await listCustomers(a)).items).toHaveLength(0);
    expect((await db.customer.findUniqueOrThrow({ where: { id: cb.id } })).firstName).toBe("Jan");
  });

  it("content pages", async () => {
    const pageB = await createPage(b, { title: "B's page" });
    await rejects(getPage(a, pageB.id));
    await rejects(updatePage(a, pageB.id, { title: "pwned" }));
    await rejects(deletePage(a, pageB.id));
    expect((await listPages(a)).map((p) => p.id)).not.toContain(pageB.id);
    expect((await db.contentPage.findUniqueOrThrow({ where: { id: pageB.id } })).title).toBe("B's page");
  });

  it("redirects", async () => {
    const rb = await createRedirect(b, { fromPath: "/old", toPath: "/new" });
    await rejects(getRedirect(a, rb.id));
    await rejects(updateRedirect(a, rb.id, { fromPath: "/old", toPath: "/pwned" }));
    await rejects(deleteRedirect(a, rb.id));
    expect((await listRedirects(a)).rows.map((r) => r.id)).not.toContain(rb.id);
    expect((await db.redirect.findUniqueOrThrow({ where: { id: rb.id } })).toPath).toBe("/new");
  });
});

describe("tenantDb (defence-in-depth client)", () => {
  it("cannot see or change another tenant's rows, even by unique id", async () => {
    const pb = await makeProduct(b.tenantId);
    const tdb = tenantDb(a.tenantId);
    expect(await tdb.product.findUnique({ where: { id: pb.id } })).toBeNull();
    expect(await tdb.product.findFirst({ where: { slug: pb.slug } })).toBeNull();
    expect(await tdb.product.count()).toBe(0);
    expect((await tdb.product.updateMany({ data: { title: "pwned" } })).count).toBe(0);
    expect((await tdb.product.deleteMany({})).count).toBe(0);
    await expect(tdb.product.update({ where: { id: pb.id }, data: { title: "pwned" } })).rejects.toMatchObject({ code: "P2025" });
    await expect(tdb.product.delete({ where: { id: pb.id } })).rejects.toMatchObject({ code: "P2025" });
    expect((await db.product.findUniqueOrThrow({ where: { id: pb.id } })).title).toBe(pb.title);
  });

  it("refuses explicit cross-tenant filters, writes and moves", async () => {
    const pa = await makeProduct(a.tenantId);
    const tdb = tenantDb(a.tenantId);
    await expect(tdb.product.findMany({ where: { tenantId: b.tenantId } })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      tdb.contentPage.create({ data: { tenantId: b.tenantId, slug: "x", title: "x" } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(tdb.product.update({ where: { id: pa.id }, data: { tenantId: b.tenantId } })).rejects.toBeInstanceOf(TenantScopeError);
    // A create without tenantId is put in the client's tenant.
    const page = await tdb.contentPage.create({ data: { slug: "about-x", title: "About" } as never });
    expect(page.tenantId).toBe(a.tenantId);
  });

  it("keeps the scope inside interactive transactions", async () => {
    const pb = await makeProduct(b.tenantId);
    const pa = await makeProduct(a.tenantId);
    const seen = await tenantDb(a.tenantId).$transaction(async (tx) => {
      return { own: await tx.product.findUnique({ where: { id: pa.id } }), other: await tx.product.findUnique({ where: { id: pb.id } }) };
    });
    expect(seen.own?.id).toBe(pa.id);
    expect(seen.other).toBeNull();
  });
});
