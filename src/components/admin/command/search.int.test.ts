import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { makeOrder, makeProduct } from "@/server/orders/test-fixtures";
import { createTenantContext, resetDb } from "../../../../tests/integration/helpers";
import { PER_GROUP, searchCommands, searchSettings } from "./search";

beforeEach(resetDb);

const ids = (groups: Awaited<ReturnType<typeof searchCommands>>, group: string) => groups.find((g) => g.id === group)?.items.map((i) => i.id) ?? [];

describe("command palette search", () => {
  it("only returns rows of the caller's tenant", async () => {
    const a = await createTenantContext();
    const b = await createTenantContext();
    const pa = await makeProduct(a.tenantId, { title: "Stahlhelm M40 Heer" });
    const pb = await makeProduct(b.tenantId, { title: "Stahlhelm M35 Luftwaffe" });
    const oa = await makeOrder(a.tenantId, { lines: [{ product: pa }], email: "collector@example.test", name: "Stahl Collector" });
    const ob = await makeOrder(b.tenantId, { lines: [{ product: pb }], email: "collector@example.test", name: "Stahl Collector" });
    const ca = await db.customer.create({ data: { tenantId: a.tenantId, email: "collector@example.test", firstName: "Piet", lastName: "Stahl" } });
    const cb = await db.customer.create({ data: { tenantId: b.tenantId, email: "collector@example.test", firstName: "Piet", lastName: "Stahl" } });
    const pageA = await db.contentPage.create({ data: { tenantId: a.tenantId, slug: "stahlhelm-guide", title: "Stahlhelm guide" } });
    await db.contentPage.create({ data: { tenantId: b.tenantId, slug: "stahlhelm-guide", title: "Stahlhelm guide" } });

    const res = await searchCommands(a, "stahl");
    expect(ids(res, "products")).toEqual([`product:${pa.id}`]);
    expect(ids(res, "orders")).toEqual([`order:${oa.id}`]);
    expect(ids(res, "customers")).toEqual([`customer:${ca.id}`]);
    expect(ids(res, "pages")).toEqual([`page:${pageA.id}`]);

    const resB = await searchCommands(b, "collector@example.test");
    expect(ids(resB, "orders")).toEqual([`order:${ob.id}`]);
    expect(ids(resB, "customers")).toEqual([`customer:${cb.id}`]);

    // Exact identifiers from another tenant are not found either.
    expect(ids(await searchCommands(a, `#${pb.stockCode}`), "products")).toEqual([]);
    expect(ids(await searchCommands(b, `#${oa.number}`), "orders")).toEqual([]);
  });

  it("matches stock code, order number and SKU exactly and puts them first; max 5 per group", async () => {
    const ctx = await createTenantContext();
    const products = [];
    for (let i = 0; i < 7; i++) products.push(await makeProduct(ctx.tenantId, { title: `Koppelschloss ${i}` }));
    const target = products[3];
    await db.product.update({ where: { id: target.id }, data: { sku: "KS-003" } });

    const byTitle = await searchCommands(ctx, "koppel");
    expect(ids(byTitle, "products")).toHaveLength(PER_GROUP);
    expect(ids(await searchCommands(ctx, String(target.stockCode)), "products")[0]).toBe(`product:${target.id}`);
    expect(ids(await searchCommands(ctx, "ks-003"), "products")).toEqual([`product:${target.id}`]);

    const order = await makeOrder(ctx.tenantId, { lines: [{ product: target }] });
    expect(ids(await searchCommands(ctx, `#${order.number}`), "orders")).toEqual([`order:${order.id}`]);
  });

  it("ignores too-short queries and finds settings sections", async () => {
    const ctx = await createTenantContext();
    expect(await searchCommands(ctx, "a")).toEqual([]);
    expect(await searchCommands(ctx, "   ")).toEqual([]);
    const s = searchSettings("currenc", false);
    expect(s[0]).toMatchObject({ href: "/admin/settings/general" });
    expect(searchSettings("platform", false)).toEqual([]);
    expect(searchSettings("platform", true).length).toBeGreaterThan(0);
  });
});
