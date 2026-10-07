import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { createProduct, setStatus } from "@/server/catalog/products";
import { adjustStock, listMovements, recordMovement, stockOverview } from "./ledger";
import { activeReservation, adminReleaseReservation, expireReservations, releaseReservation, reserveProduct } from "./reservations";

async function newCart(tenantId: string) {
  return db.cart.create({ data: { tenantId, tokenHash: `cart-${Math.random()}`, expiresAt: new Date(Date.now() + 86400_000) } });
}

describe("stock ledger", () => {
  let a: ServiceContext;
  let b: ServiceContext;
  beforeEach(async () => {
    await resetDb();
    a = await createTenantContext();
    b = await createTenantContext();
  });

  it("rejects negative stock and leaves quantity unchanged", async () => {
    const p = await createProduct(a, { title: "Cap", quantity: 1 });
    await expect(db.$transaction((tx) => recordMovement(tx, { tenantId: a.tenantId, productId: p.id, delta: -2, reason: "SALE" }))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(adjustStock(a, p.id, { delta: -5 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(db.$transaction((tx) => recordMovement(tx, { tenantId: a.tenantId, productId: p.id, delta: 0, reason: "SALE" }))).rejects.toMatchObject({
      code: "INVALID",
    });
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).quantity).toBe(1);
    expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(1);
  });

  it("does not touch another tenant's product", async () => {
    const p = await createProduct(a, { title: "Cap", quantity: 1 });
    await expect(db.$transaction((tx) => recordMovement(tx, { tenantId: b.tenantId, productId: p.id, delta: 1, reason: "ADJUSTMENT" }))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("adjustStock sets absolute quantity or applies a delta; 0 change is a no-op", async () => {
    const p = await createProduct(a, { title: "Cap", quantity: 1 });
    expect(await adjustStock(a, p.id, { quantity: 4, note: "found more" })).toMatchObject({ quantity: 4, movement: { delta: 3, quantityAfter: 4 } });
    expect(await adjustStock(a, p.id, { delta: -1 })).toMatchObject({ quantity: 3 });
    expect(await adjustStock(a, p.id, { quantity: 3 })).toEqual({ quantity: 3, movement: null });
    await expect(adjustStock(a, p.id, { quantity: 1, delta: 1 } as never)).rejects.toMatchObject({ code: "INVALID" });
    const moves = await listMovements(a, p.id);
    expect(moves.map((m) => [m.delta, m.quantityAfter])).toEqual([
      [-1, 3],
      [3, 4],
      [1, 1],
    ]);
    expect(moves[1]).toMatchObject({ note: "found more", actorEmail: a.actor.email, reason: "ADJUSTMENT" });
    expect(await listMovements(b, p.id)).toEqual([]);
  });

  it("keeps quantity and quantityAfter consistent under concurrent movements", async () => {
    const p = await createProduct(a, { title: "Ammo box", quantity: 5 });
    const deltas = [...Array(15).fill(1), ...Array(15).fill(-1), ...Array(10).fill(-1)];
    const results = await Promise.allSettled(
      deltas.map((delta) =>
        db.$transaction((tx) => recordMovement(tx, { tenantId: a.tenantId, productId: p.id, delta, reason: "ADJUSTMENT" })),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected");
    for (const r of rejected) expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT" });

    const product = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    const moves = await db.stockMovement.findMany({ where: { productId: p.id }, orderBy: { id: "asc" } });
    expect(moves).toHaveLength(ok + 1);
    const sum = moves.reduce((s, m) => s + m.delta, 0);
    expect(product.quantity).toBe(sum);
    expect(product.quantity).toBeGreaterThanOrEqual(0);
    // ledger chain: every row's quantityAfter = previous + delta
    let running = 0;
    for (const m of moves) {
      running += m.delta;
      expect(m.quantityAfter).toBe(running);
    }
  });

  it("stockOverview summarises inventory", async () => {
    const p1 = await createProduct(a, { title: "A", price: 1000, purchasePrice: 400, quantity: 2, status: "ACTIVE" });
    await createProduct(a, { title: "B", price: 500, quantity: 1 }); // draft, no purchase price
    const sold = await createProduct(a, { title: "C", price: 9999, status: "ACTIVE" });
    await setStatus(a, [sold.id], "SOLD");
    await createProduct(b, { title: "other", price: 100000, status: "ACTIVE" });
    const cart = await newCart(a.tenantId);
    await reserveProduct({ tenantId: a.tenantId, productId: p1.id, cartId: cart.id, minutes: 15 });
    expect(await stockOverview(a)).toEqual({
      forSale: 1,
      reservedNow: 1,
      sold30d: 1,
      valueAtPrice: 2500,
      valueAtCost: 800,
      withoutPurchasePrice: 1,
    });
  });
});

describe("reservations", () => {
  let a: ServiceContext;
  beforeEach(async () => {
    await resetDb();
    a = await createTenantContext();
  });

  it("allows only one active reservation per product, idempotent for the same cart", async () => {
    const p = await createProduct(a, { title: "Helmet", price: 100, status: "ACTIVE" });
    const [c1, c2] = [await newCart(a.tenantId), await newCart(a.tenantId)];
    const r1 = await reserveProduct({ tenantId: a.tenantId, productId: p.id, cartId: c1.id });
    expect(r1.status).toBe("ACTIVE");
    // default minutes from settings (15)
    const mins = (r1.expiresAt.getTime() - r1.createdAt.getTime()) / 60000;
    expect(mins).toBeGreaterThan(14.9);
    expect(mins).toBeLessThan(15.1);
    expect((await reserveProduct({ tenantId: a.tenantId, productId: p.id, cartId: c1.id })).id).toBe(r1.id);
    await expect(reserveProduct({ tenantId: a.tenantId, productId: p.id, cartId: c2.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Product is already reserved",
    });
    expect((await activeReservation(a.tenantId, p.id))?.id).toBe(r1.id);
  });

  it("is exclusive under concurrency", async () => {
    const p = await createProduct(a, { title: "Helmet", price: 100, status: "ACTIVE" });
    const carts = await Promise.all(Array.from({ length: 8 }, () => newCart(a.tenantId)));
    const results = await Promise.allSettled(carts.map((c) => reserveProduct({ tenantId: a.tenantId, productId: p.id, cartId: c.id, minutes: 15 })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.reservation.count({ where: { productId: p.id, status: "ACTIVE" } })).toBe(1);
  });

  it("an expired hold is replaced by the next reserve and swept by expireReservations", async () => {
    const p = await createProduct(a, { title: "Helmet", price: 100, status: "ACTIVE" });
    const q = await createProduct(a, { title: "Cap", price: 100, status: "ACTIVE" });
    const [c1, c2] = [await newCart(a.tenantId), await newCart(a.tenantId)];
    const r1 = await reserveProduct({ tenantId: a.tenantId, productId: p.id, cartId: c1.id, minutes: 15 });
    const rq = await reserveProduct({ tenantId: a.tenantId, productId: q.id, cartId: c1.id, minutes: 15 });
    await db.reservation.updateMany({ where: { id: { in: [r1.id, rq.id] } }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await activeReservation(a.tenantId, p.id)).toBeNull();
    const r2 = await reserveProduct({ tenantId: a.tenantId, productId: p.id, cartId: c2.id, minutes: 15 });
    expect(r2.cartId).toBe(c2.id);
    expect(await db.reservation.findUniqueOrThrow({ where: { id: r1.id } })).toMatchObject({ status: "EXPIRED" });

    expect(await expireReservations(a.tenantId)).toBe(1);
    expect(await db.reservation.findUniqueOrThrow({ where: { id: rq.id } })).toMatchObject({ status: "EXPIRED" });
    expect(await expireReservations()).toBe(0);
  });

  it("releases, and refuses unavailable products", async () => {
    const p = await createProduct(a, { title: "Helmet", price: 100, status: "ACTIVE" });
    const draft = await createProduct(a, { title: "Draft" });
    const cart = await newCart(a.tenantId);
    await expect(reserveProduct({ tenantId: a.tenantId, productId: draft.id, cartId: cart.id })).rejects.toMatchObject({ code: "CONFLICT" });
    const other = await createTenantContext();
    await expect(reserveProduct({ tenantId: other.tenantId, productId: p.id, cartId: cart.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const r = await reserveProduct({ tenantId: a.tenantId, productId: p.id, cartId: cart.id });
    expect(await releaseReservation({ tenantId: other.tenantId, reservationId: r.id })).toBe(0);
    expect(await releaseReservation({ tenantId: a.tenantId, productId: p.id, cartId: "someone-else" })).toBe(0);
    expect(await releaseReservation({ tenantId: a.tenantId, reservationId: r.id })).toBe(1);
    expect(await activeReservation(a.tenantId, p.id)).toBeNull();

    await reserveProduct({ tenantId: a.tenantId, productId: p.id, cartId: cart.id });
    expect(await adminReleaseReservation(a, p.id)).toBe(true);
    expect(await adminReleaseReservation(a, p.id)).toBe(false);
  });

  it("works inside a caller's transaction and keeps it usable after a conflict", async () => {
    const p = await createProduct(a, { title: "Helmet", price: 100, status: "ACTIVE" });
    const [c1, c2] = [await newCart(a.tenantId), await newCart(a.tenantId)];
    await reserveProduct({ tenantId: a.tenantId, productId: p.id, cartId: c1.id, minutes: 15 });
    const after = await db.$transaction(async (tx) => {
      await expect(reserveProduct({ tenantId: a.tenantId, productId: p.id, cartId: c2.id, minutes: 15 }, tx)).rejects.toMatchObject({ code: "CONFLICT" });
      return tx.product.count({ where: { tenantId: a.tenantId } }); // tx not aborted
    });
    expect(after).toBe(1);
  });
});
