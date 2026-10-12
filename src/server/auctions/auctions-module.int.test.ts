import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { installHarness } from "../../../tests/integration/mail-harness";
import { makeProduct } from "../orders/test-fixtures";
import {
  acceptAuctionTerms,
  addLots,
  closeLot,
  createAuction,
  getAuctionPayView,
  getPublicLot,
  listAuctionsAdmin,
  listPublicAuctions,
  lotForProduct,
  placeBid,
  publishAuction,
  tickOnce,
  type ShopCustomerContext,
} from "./index";
import { payToken } from "./shared";

/*
 * Auctions as a paid module (docs/modules.md § Eén controle, vijf plekken): without the module the admin,
 * storefront and bidding services refuse with UNAVAILABLE; lots that were already running still close and
 * their winners can still pay (wind-down).
 */

let h: ReturnType<typeof installHarness>;
beforeEach(async () => {
  await resetDb();
  h = installHarness();
});
afterEach(() => h.uninstall());

let rid = 0;
const req = () => `mod-${Date.now().toString(36)}-${++rid}`;

let n = 0;
async function bidder(tenantId: string): Promise<ShopCustomerContext> {
  n += 1;
  const email = `mod-bidder-${n}@example.test`;
  const user = await db.user.create({ data: { role: "CUSTOMER", tenantId, email, emailVerifiedAt: new Date() } });
  const c = await db.customer.create({ data: { tenantId, email, userId: user.id, firstName: "Bidder", lastName: `${n}` } });
  return { tenantId, customerId: c.id, userId: user.id, ip: `198.51.100.${n % 250}`, country: null };
}

async function auctionWithLot(ctx: Awaited<ReturnType<typeof createTenantContext>>, opts: { opensInMs?: number } = {}) {
  const product = await makeProduct(ctx.tenantId, { price: 20000, purchasePrice: 8000 });
  const now = Date.now();
  const auction = await createAuction(ctx, {
    type: "DAY",
    title: "Module veiling",
    opensAt: new Date(now + (opts.opensInMs ?? -60_000)),
    firstCloseAt: new Date(now + 60 * 60_000),
    gapSeconds: 60,
    extendSeconds: 120,
  });
  await addLots(ctx, auction.id, [product.id]);
  await publishAuction(ctx, auction.id);
  const lot = await db.auctionLot.findFirstOrThrow({ where: { auctionId: auction.id } });
  return { product, auctionId: auction.id, lot };
}

const unavailable = { code: "UNAVAILABLE", details: { module: "auctions" } };

describe("auctions module gating", () => {
  it("START plan: admin, storefront and bidding services refuse with UNAVAILABLE", async () => {
    const ctx = await createTenantContext({ plan: "START" });
    const customer = await bidder(ctx.tenantId);

    await expect(createAuction(ctx, { title: "Nope", opensAt: new Date(), firstCloseAt: new Date(Date.now() + 3_600_000) })).rejects.toMatchObject(unavailable);
    await expect(listAuctionsAdmin(ctx)).rejects.toMatchObject(unavailable);
    await expect(listPublicAuctions(ctx.tenantId)).rejects.toMatchObject(unavailable);
    await expect(getPublicLot(ctx.tenantId, "missing-lot")).rejects.toMatchObject(unavailable);
    await expect(acceptAuctionTerms(customer, "missing-auction")).rejects.toMatchObject(unavailable);
    await expect(placeBid(customer, { lotId: "missing-lot", maxAmount: 15000, requestId: req() })).rejects.toMatchObject(unavailable);
    // The product page's lookup degrades to "not in an auction" instead of throwing.
    await expect(lotForProduct(ctx.tenantId, "missing-product")).resolves.toBeNull();
    expect(await db.auction.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
  });

  it("COMPLETE plan: the same calls work", async () => {
    const ctx = await createTenantContext({ plan: "COMPLETE" });
    const { lot, auctionId } = await auctionWithLot(ctx);
    const customer = await bidder(ctx.tenantId);

    expect((await listAuctionsAdmin(ctx)).map((a) => a.id)).toEqual([auctionId]);
    // Published with an opening time in the past: listed as live once the tick has opened it, else as upcoming.
    const listed = await listPublicAuctions(ctx.tenantId);
    expect([...listed.live, ...listed.upcoming].map((a) => a.id)).toEqual([auctionId]);
    await acceptAuctionTerms(customer, auctionId);
    await expect(placeBid(customer, { lotId: lot.id, maxAmount: 15000, requestId: req() })).resolves.toMatchObject({ ok: true, isLeading: true });
    expect(await getPublicLot(ctx.tenantId, lot.id)).toMatchObject({ id: lot.id, bidCount: 1 });
  });

  it("module removed mid-auction: no new bids, but the running lot closes and the winner can pay", async () => {
    const ctx = await createTenantContext({ plan: "COMPLETE" });
    const { lot, auctionId } = await auctionWithLot(ctx);
    const winner = await bidder(ctx.tenantId);
    await acceptAuctionTerms(winner, auctionId);
    await placeBid(winner, { lotId: lot.id, maxAmount: 15000, requestId: req() });
    // A second, scheduled auction that has not opened yet.
    const later = await auctionWithLot(ctx, { opensInMs: 60_000 });

    await db.tenantPlan.update({ where: { tenantId: ctx.tenantId }, data: { plan: "START" } });

    const late = await bidder(ctx.tenantId);
    await expect(placeBid(winner, { lotId: lot.id, maxAmount: 30000, requestId: req() })).rejects.toMatchObject(unavailable);
    await expect(acceptAuctionTerms(late, auctionId)).rejects.toMatchObject(unavailable);

    // The scheduler does not open the scheduled auction of a shop without the module …
    await tickOnce({ now: new Date(Date.now() + 2 * 60_000), ending: false });
    expect((await db.auction.findUniqueOrThrow({ where: { id: later.auctionId } })).status).toBe("PUBLISHED");

    // … but the running lot still closes (close-lot job / tick) and the winner's pay link works.
    await db.auctionLot.update({ where: { id: lot.id }, data: { closesAt: new Date(Date.now() - 1000) } });
    await expect(closeLot(lot.id)).resolves.toMatchObject({ result: "SOLD", amount: 12000 });
    const sold = await db.auctionLot.findUniqueOrThrow({ where: { id: lot.id } });
    const view = await getAuctionPayView(ctx.tenantId, payToken(ctx.tenantId, sold.id, sold.orderId!));
    expect(view).toMatchObject({ state: "ready" });
  });
});
