import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { destroySession } from "@/server/auth/session";
import { registerCustomer } from "@/server/customer-auth";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { makeProduct } from "../orders/test-fixtures";
import { addToWishlist, listWishlist, removeFromWishlist, wishlistCount, wishlistProductIds } from "./index";

const host = vi.hoisted(() => ({ tenant: null as null | { id: string } }));
vi.mock("@/server/tenant", () => ({ getRequestTenant: async () => host.tenant }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

beforeEach(async () => {
  await resetDb();
  await destroySession();
  host.tenant = null;
});

async function customer(tenantId: string, email = "w@example.test") {
  const r = await registerCustomer({ tenantId, email, name: "W", password: "correct horse battery" });
  if (!r.ok) throw new Error(r.error);
  return { tenantId, customerId: r.customerId };
}

describe("wishlist service", () => {
  it("adds visible products only, is idempotent, lists availability and removes", async () => {
    const ctx = await createTenantContext();
    const other = await createTenantContext();
    const owner = await customer(ctx.tenantId);
    const active = await makeProduct(ctx.tenantId, { title: "Helmet" });
    const reserved = await makeProduct(ctx.tenantId, { title: "Badge" });
    const sold = await makeProduct(ctx.tenantId, { title: "Medal" });
    const draft = await makeProduct(ctx.tenantId, { title: "Draft" });
    const foreign = await makeProduct(other.tenantId, { title: "Other shop" });
    await db.product.update({ where: { id: draft.id }, data: { status: "DRAFT" } });
    await db.reservation.create({ data: { tenantId: ctx.tenantId, productId: reserved.id, expiresAt: new Date(Date.now() + 60_000) } });

    expect(await addToWishlist(owner, active.id)).toEqual({ ok: true, inWishlist: true });
    expect(await addToWishlist(owner, active.id)).toEqual({ ok: true, inWishlist: true });
    expect(await addToWishlist(owner, reserved.id)).toMatchObject({ ok: true });
    expect(await addToWishlist(owner, sold.id)).toMatchObject({ ok: true });
    expect(await addToWishlist(owner, draft.id)).toEqual({ ok: false, error: "not_found" });
    expect(await addToWishlist(owner, foreign.id)).toEqual({ ok: false, error: "not_found" });

    await db.product.update({ where: { id: sold.id }, data: { status: "SOLD", quantity: 0 } });
    const list = await listWishlist(owner);
    expect(Object.fromEntries(list.map((i) => [i.title, i.availability]))).toEqual({ Helmet: "available", Badge: "reserved", Medal: "sold" });
    expect(Object.keys(list[0])).not.toContain("purchasePrice");
    expect(await wishlistCount(owner)).toBe(3);

    // Archiving hides an item without deleting it.
    await db.product.update({ where: { id: active.id }, data: { status: "ARCHIVED" } });
    expect((await listWishlist(owner)).map((i) => i.title).sort()).toEqual(["Badge", "Medal"]);

    await removeFromWishlist(owner, reserved.id);
    expect([...(await wishlistProductIds(owner))]).toEqual([sold.id]); // archived one is hidden
    expect(await db.wishlistItem.count({ where: { customerId: owner.customerId } })).toBe(2); // …but kept

    // Another customer of another shop can't touch these rows.
    const stranger = await customer(other.tenantId, "w@example.test");
    await removeFromWishlist({ tenantId: other.tenantId, customerId: owner.customerId }, sold.id);
    expect((await wishlistProductIds(owner)).has(sold.id)).toBe(true);
    expect(await wishlistProductIds(stranger)).toEqual(new Set());
  });
});

describe("wishlist actions (auth)", () => {
  it("guests are rejected; only a customer of this host can toggle", async () => {
    const { getWishlistStateAction, toggleWishlistAction } = await import("@/components/shop/account/actions");
    const ctx = await createTenantContext();
    const p = await makeProduct(ctx.tenantId);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    host.tenant = tenant;

    expect(await getWishlistStateAction()).toEqual({ loggedIn: false, productIds: [] });
    expect(await toggleWishlistAction(p.id, true)).toEqual({ ok: false, error: "unauthenticated" });
    expect(await db.wishlistItem.count()).toBe(0);

    await customer(ctx.tenantId); // registers + signs in
    expect(await toggleWishlistAction(p.id, true)).toEqual({ ok: true, inWishlist: true });
    expect(await getWishlistStateAction()).toEqual({ loggedIn: true, productIds: [p.id] });
    expect(await toggleWishlistAction(p.id, "yes")).toEqual({ ok: false, error: "invalid" });

    // Same session on another shop's host = guest.
    const other = await createTenantContext();
    host.tenant = await db.tenant.findUniqueOrThrow({ where: { id: other.tenantId } });
    expect(await toggleWishlistAction(p.id, false)).toEqual({ ok: false, error: "unauthenticated" });
    expect(await db.wishlistItem.count()).toBe(1);
  });
});
