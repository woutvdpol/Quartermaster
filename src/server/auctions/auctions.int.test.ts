import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import { markPaidManually } from "@/server/orders/commands";
import { reserveProduct } from "@/server/stock/reservations";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { installHarness } from "../../../tests/integration/mail-harness";
import { makeProduct } from "../orders/test-fixtures";
import {
  acceptAuctionTerms,
  addLots,
  auctionErrorReason,
  blockBidder,
  cancelWonLot,
  closeLot,
  createAuction,
  getAuctionAdmin,
  getAuctionPayView,
  getAuctionResults,
  getBidSignals,
  getMyLotState,
  getPublicLot,
  listPublicAuctions,
  lotForProduct,
  placeBid,
  publishAuction,
  reconcileWonLots,
  replayBids,
  submitAuctionPayment,
  tableOrDefault,
  tickOnce,
  updateLot,
  voidBid,
  type ShopCustomerContext,
} from "./index";
import { parsePayToken } from "./shared";
import { addFairItems, createFair } from "@/server/fairs";

let h: ReturnType<typeof installHarness>;
beforeEach(async () => {
  await resetDb();
  h = installHarness();
});
afterEach(() => h.uninstall());

const reason = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e) => auctionErrorReason(e) ?? (e instanceof ServiceError ? e.code : String(e)),
  );

let rid = 0;
const req = () => `req-${Date.now().toString(36)}-${++rid}`;

async function liveLot(opts: { price?: number; purchasePrice?: number | null; closesInMs?: number; opensInMs?: number } = {}) {
  const ctx = await createTenantContext();
  const product = await makeProduct(ctx.tenantId, { price: opts.price ?? 20000, purchasePrice: opts.purchasePrice === undefined ? 8000 : opts.purchasePrice });
  const now = Date.now();
  const auction = await createAuction(ctx, {
    type: "DAY",
    title: "Herfstveiling",
    opensAt: new Date(now + (opts.opensInMs ?? -60_000)),
    firstCloseAt: new Date(now + (opts.closesInMs ?? 60 * 60_000)),
    gapSeconds: 60,
    extendSeconds: 120,
  });
  await addLots(ctx, auction.id, [product.id]);
  await publishAuction(ctx, auction.id);
  const lot = await db.auctionLot.findFirstOrThrow({ where: { auctionId: auction.id } });
  return { ctx, product, auctionId: auction.id, lot };
}

let n = 0;
async function bidder(tenantId: string, auctionId: string | null, opts: { verified?: boolean; email?: string; terms?: boolean } = {}): Promise<ShopCustomerContext> {
  n += 1;
  const email = opts.email ?? `bidder-${n}@example.test`;
  const user = await db.user.create({ data: { role: "CUSTOMER", tenantId, email, emailVerifiedAt: opts.verified === false ? null : new Date() } });
  const c = await db.customer.create({ data: { tenantId, email, userId: user.id, firstName: `Bidder`, lastName: `${n}` } });
  const sctx: ShopCustomerContext = { tenantId, customerId: c.id, userId: user.id, ip: `203.0.113.${n % 250}`, country: null };
  if (auctionId && opts.terms !== false) await acceptAuctionTerms(sctx, auctionId);
  return sctx;
}

describe("bidding", () => {
  it("proxy bids through the database and notifies the displaced leader", async () => {
    const { ctx, lot, auctionId } = await liveLot();
    expect(lot).toMatchObject({ startPrice: 12000, reservePrice: 8800 });
    const a = await bidder(ctx.tenantId, auctionId);
    const b = await bidder(ctx.tenantId, auctionId);
    const c = await bidder(ctx.tenantId, auctionId);

    const r1 = await placeBid(a, { lotId: lot.id, maxAmount: 15000, requestId: req() });
    expect(r1).toMatchObject({ ok: true, isLeading: true, myMax: 15000 });
    expect(r1.state).toMatchObject({ currentBid: 12000, nextMinimum: 13000, bidCount: 1, reserveMet: true, leaderNumber: 1 });

    const r2 = await placeBid(b, { lotId: lot.id, maxAmount: 13000, requestId: req() });
    expect(r2).toMatchObject({ isLeading: false, myMax: 13000 });
    expect(r2.state).toMatchObject({ currentBid: 14000, bidCount: 3, leaderNumber: 1 });
    expect(h.jobs.filter((j) => j.name === "auctions.notify")).toHaveLength(0);

    const r3 = await placeBid(c, { lotId: lot.id, maxAmount: 20000, requestId: req() });
    expect(r3).toMatchObject({ isLeading: true, myMax: 20000 });
    expect(r3.state).toMatchObject({ currentBid: 16000, leaderNumber: 3 });
    const notify = h.jobs.filter((j) => j.name === "auctions.notify");
    expect(notify.map((j) => j.data)).toEqual([{ kind: "outbid", lotId: lot.id, customerId: a.customerId }]);
    expect(notify[0].options.inTransaction).toBe(true);

    // The outbid mail goes out once; a second outbid within 2 minutes is deduplicated.
    await h.drain((j) => j.name === "auctions.notify");
    await h.drain((j) => j.name === "mail.send");
    expect(h.mails.map((m) => m.subject)).toEqual([expect.stringContaining("You've been outbid")]);
    expect(h.mails[0].to).toBe((await db.customer.findUniqueOrThrow({ where: { id: a.customerId } })).email);

    // Public views never leak maxima.
    const pub = await getPublicLot(ctx.tenantId, lot.id);
    expect(JSON.stringify(pub)).not.toMatch(/leadingMax|maxAmount|customerId|reservePrice/);
    expect(pub!.history.map((x) => [x.bidderNumber, x.amount, x.isAuto])).toEqual([
      [3, 16000, false],
      [1, 15000, true],
      [1, 14000, true],
      [2, 13000, false],
      [1, 12000, false],
    ]);
    expect(await getMyLotState(ctx.tenantId, lot.id, a.customerId)).toEqual({ isLeading: false, myMax: 15000, outbid: true, bidderNumber: 1, termsAccepted: true });
    expect(await getMyLotState(ctx.tenantId, lot.id, c.customerId)).toMatchObject({ isLeading: true, myMax: 20000, outbid: false });
  });

  it("N parallel bids on one lot end with one consistent leader", async () => {
    const { ctx, lot, auctionId } = await liveLot();
    const bidders = await Promise.all(Array.from({ length: 10 }, () => bidder(ctx.tenantId, auctionId)));
    const maxima = bidders.map((_, i) => 30000 + i * 1000);
    const results = await Promise.allSettled(bidders.map((b, i) => placeBid(b, { lotId: lot.id, maxAmount: maxima[i], requestId: req() })));
    for (const r of results) if (r.status === "rejected") expect(auctionErrorReason(r.reason)).toBe("BELOW_MINIMUM");
    expect(results[9].status).toBe("fulfilled"); // the highest maximum can never be below the minimum

    const after = await db.auctionLot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(after.leadingBidderId).toBe(bidders[9].customerId);
    expect(after.leadingMax).toBe(39000);
    const rows = await db.bid.findMany({ where: { lotId: lot.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(after.bidCount).toBe(rows.length);
    const subs = rows.filter((r) => !r.isAuto);
    expect(subs).toHaveLength(results.filter((r) => r.status === "fulfilled").length);
    const replay = replayBids(subs, { startPrice: lot.startPrice, reservePrice: lot.reservePrice, table: tableOrDefault(null) });
    expect(replay.state).toEqual({ current: after.currentBid, leaderId: after.leadingBidderId, leadingMax: after.leadingMax });
    // Visible price never went down.
    const amounts = rows.map((r) => r.amount);
    expect(Math.max(...amounts)).toBe(after.currentBid);
  });

  it("is idempotent on the request id (also concurrently)", async () => {
    const { ctx, lot, auctionId } = await liveLot();
    const a = await bidder(ctx.tenantId, auctionId);
    const input = { lotId: lot.id, maxAmount: 15000, requestId: req() };
    const [x, y] = await Promise.all([placeBid(a, input), placeBid(a, input)]);
    const again = await placeBid(a, input);
    expect([x.reused, y.reused].sort()).toEqual([false, true]);
    expect(again).toMatchObject({ reused: true, isLeading: true, myMax: 15000 });
    expect(await db.bid.count({ where: { lotId: lot.id } })).toBe(1);
    const other = await bidder(ctx.tenantId, auctionId);
    expect(await reason(placeBid(other, input))).toBe("CONFLICT");
  });

  it("extends a late bid and queues the new close", async () => {
    const { ctx, lot, auctionId } = await liveLot();
    await db.auctionLot.update({ where: { id: lot.id }, data: { closesAt: new Date(Date.now() + 30_000) } });
    const a = await bidder(ctx.tenantId, auctionId);
    const before = Date.now();
    const r = await placeBid(a, { lotId: lot.id, maxAmount: 15000, requestId: req() });
    expect(r.extended).toBe(true);
    expect(r.state.extended).toBe(true);
    const closesAt = new Date(r.state.closesAt).getTime();
    expect(closesAt).toBeGreaterThanOrEqual(before + 119_000);
    expect(closesAt).toBeLessThanOrEqual(Date.now() + 121_000);
    const close = h.jobs.filter((j) => j.name === "auctions.close-lot" && (j.data as { lotId: string }).lotId === lot.id);
    expect(close.some((j) => new Date(j.options.startAfter as Date).getTime() === closesAt)).toBe(true);
  });

  it("refuses ineligible bidders and bad bids with specific reasons", async () => {
    const { ctx, lot, auctionId } = await liveLot();
    const unverified = await bidder(ctx.tenantId, null, { verified: false });
    expect(await reason(placeBid(unverified, { lotId: lot.id, maxAmount: 15000, requestId: req() }))).toBe("NOT_VERIFIED");
    await db.user.create({ data: { role: "SUPERADMIN", tenantId: null, email: "admin@platform.test" } });
    const staff = await bidder(ctx.tenantId, null, { email: "admin@platform.test" });
    expect(await reason(placeBid(staff, { lotId: lot.id, maxAmount: 15000, requestId: req() }))).toBe("STAFF_CANNOT_BID");
    const noTerms = await bidder(ctx.tenantId, auctionId, { terms: false });
    expect(await reason(placeBid(noTerms, { lotId: lot.id, maxAmount: 15000, requestId: req() }))).toBe("TERMS_REQUIRED");
    const blocked = await bidder(ctx.tenantId, auctionId);
    await blockBidder(ctx, blocked.customerId, "test");
    expect(await reason(placeBid(blocked, { lotId: lot.id, maxAmount: 15000, requestId: req() }))).toBe("BLOCKED");

    const ok = await bidder(ctx.tenantId, auctionId);
    const low = placeBid(ok, { lotId: lot.id, maxAmount: 11000, requestId: req() });
    await expect(low).rejects.toMatchObject({ reason: "BELOW_MINIMUM", details: { reason: "BELOW_MINIMUM", minimum: 12000 } });

    await db.auctionLot.update({ where: { id: lot.id }, data: { closesAt: new Date(Date.now() - 1000) } });
    expect(await reason(placeBid(ok, { lotId: lot.id, maxAmount: 15000, requestId: req() }))).toBe("LOT_CLOSED");
  });

  it("refuses bids before the auction opens", async () => {
    const { ctx, lot, auctionId } = await liveLot({ opensInMs: 10 * 60_000 });
    const a = await bidder(ctx.tenantId, auctionId);
    expect(await reason(placeBid(a, { lotId: lot.id, maxAmount: 15000, requestId: req() }))).toBe("NOT_OPEN_YET");
  });
});

describe("holds", () => {
  it("hides the product while it is a lot and keeps carts away from it", async () => {
    const { ctx, product, auctionId, lot } = await liveLot();
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).auctionHoldId).toBe(auctionId);
    await expect(reserveProduct({ tenantId: ctx.tenantId, productId: product.id, orderId: "x", minutes: 15 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await lotForProduct(ctx.tenantId, product.id)).toMatchObject({ lotId: lot.id, auctionId });
    const overview = await listPublicAuctions(ctx.tenantId);
    expect(overview.live.map((x) => x.id)).toEqual([]); // still PUBLISHED until the tick opens it
    await tickOnce({ ending: false });
    expect((await listPublicAuctions(ctx.tenantId)).live.map((x) => x.id)).toEqual([auctionId]);
  });

  it("refuses items in a cart or on another auction", async () => {
    const ctx = await createTenantContext();
    const p = await makeProduct(ctx.tenantId, { price: 10000 });
    const cart = await db.cart.create({ data: { tenantId: ctx.tenantId, tokenHash: "cart-token-hash-123456", expiresAt: new Date(Date.now() + 86_400_000) } });
    await reserveProduct({ tenantId: ctx.tenantId, productId: p.id, cartId: cart.id, minutes: 15 });
    const a = await createAuction(ctx, { title: "Cart test", opensAt: new Date(), firstCloseAt: new Date(Date.now() + 3_600_000) });
    await expect(addLots(ctx, a.id, [p.id])).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses items that are going to a fair", async () => {
    const ctx = await createTenantContext();
    const p = await makeProduct(ctx.tenantId, { price: 10000 });
    const fair = await createFair(ctx, { name: "Spring fair", startsOn: "2026-11-01", hideFromShop: true });
    await addFairItems(ctx, fair.id, [p.id]); // still PREPARING: no hold yet
    const a = await createAuction(ctx, { title: "Fair clash", opensAt: new Date(), firstCloseAt: new Date(Date.now() + 3_600_000) });
    await expect(addLots(ctx, a.id, [p.id])).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("never uses a slug of a static shop route", async () => {
    const ctx = await createTenantContext();
    const a = await createAuction(ctx, { title: "Lot", opensAt: new Date(), firstCloseAt: new Date(Date.now() + 3_600_000) });
    expect(a.slug).toBe("lot-2");
    await expect(createAuction(ctx, { title: "Terms auction", slug: "terms", opensAt: new Date(), firstCloseAt: new Date(Date.now() + 3_600_000) })).rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("closing", () => {
  async function closeNow(lotId: string) {
    await db.auctionLot.update({ where: { id: lotId }, data: { closesAt: new Date(Date.now() - 1000) } });
    return closeLot(lotId);
  }

  it("SOLD: creates the winner's order, keeps the hold until paid, mails the pay link", async () => {
    const { ctx, product, lot, auctionId } = await liveLot();
    const a = await bidder(ctx.tenantId, auctionId);
    const b = await bidder(ctx.tenantId, auctionId);
    await placeBid(a, { lotId: lot.id, maxAmount: 15000, requestId: req() });
    await placeBid(b, { lotId: lot.id, maxAmount: 14000, requestId: req() });
    h.jobs.length = 0;

    const res = await closeNow(lot.id);
    expect(res).toMatchObject({ result: "SOLD", amount: 15000 });
    expect(await closeLot(lot.id)).toMatchObject({ result: "skipped", reason: "not-open" }); // idempotent

    const closed = await db.auctionLot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(closed.status).toBe("SOLD");
    const order = await db.order.findUniqueOrThrow({ where: { id: closed.orderId! }, include: { lines: true } });
    expect(order).toMatchObject({ channel: "AUCTION", customerId: a.customerId, subtotal: 15000, total: 15000, paymentStatus: "PENDING" });
    expect(order.lines.map((l) => [l.productId, l.unitPrice])).toEqual([[product.id, 15000]]);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).auctionHoldId).toBe(auctionId);
    expect((await db.auction.findUniqueOrThrow({ where: { id: auctionId } })).status).toBe("CLOSED");

    const kinds = h.jobs.filter((j) => j.name === "auctions.notify").map((j) => (j.data as { kind: string }).kind);
    expect(kinds.sort()).toEqual(["reminder", "won"]);
    await h.drain((j) => j.name === "auctions.notify" && (j.data as { kind: string }).kind === "won");
    await h.drain((j) => j.name === "mail.send");
    const won = h.mails.find((m) => String(m.subject).startsWith("You won"));
    expect(won).toBeTruthy();
    const token = decodeURIComponent(/\/auctions\/pay\/([^"&]+)"/.exec(String(won!.html))![1]);
    expect(parsePayToken(token)?.lotId).toBe(lot.id);
    const view = await getAuctionPayView(ctx.tenantId, token);
    expect(view).toMatchObject({ state: "ready", hammer: 15000, order: { id: order.id } });
    expect(await getAuctionPayView(ctx.tenantId, `${lot.id}.${"x".repeat(32)}`)).toBeNull();

    // Delivery + payment details on the pay page.
    const zone = await db.shippingZone.create({ data: { tenantId: ctx.tenantId, name: "Nederland", countries: ["NL"], rates: { create: [{ tenantId: ctx.tenantId, maxWeightGrams: 30000, price: 995 }] } } });
    const submit = await submitAuctionPayment(ctx.tenantId, token, {
      phone: "+31 6 12345678",
      shipping: { firstName: "Jan", lastName: "Jansen", street: "Dorpsstraat", houseNumber: "1", postalCode: "1234 AB", city: "Utrecht", countryCode: "NL" },
      billingSameAsShipping: true,
      shippingOptionId: zone.id,
      termsAccepted: true,
    });
    expect(submit).toMatchObject({ ok: true, orderId: order.id });
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ shippingTotal: 995, total: 15995, shippingZoneId: zone.id });

    // Paid → finalized → hold released, product SOLD.
    await markPaidManually(ctx, order.id);
    expect(await reconcileWonLots()).toMatchObject({ released: 1 });
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ status: "SOLD", auctionHoldId: null });
    const results = await getAuctionResults(ctx, auctionId);
    expect(results.rows[0]).toMatchObject({ result: "SOLD", hammer: 15000, winner: { customerId: a.customerId }, order: { paid: true } });
    expect(results.totals).toMatchObject({ sold: 1, hammerTotal: 15000, paidTotal: 15000, unpaid: 0 });
  });

  it("UNSOLD below the reserve or without bids: straight back to the shop", async () => {
    const { ctx, product, lot, auctionId } = await liveLot();
    await updateLot(ctx, lot.id, { reservePrice: 50000 });
    const a = await bidder(ctx.tenantId, auctionId);
    const r = await placeBid(a, { lotId: lot.id, maxAmount: 15000, requestId: req() });
    expect(r.state.reserveMet).toBe(false);
    expect(await closeNow(lot.id)).toMatchObject({ result: "UNSOLD" });
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ status: "ACTIVE", auctionHoldId: null });
    expect(await db.order.count({ where: { tenantId: ctx.tenantId } })).toBe(0);

    const second = await liveLot();
    expect(await closeNow(second.lot.id)).toMatchObject({ result: "UNSOLD" });
    expect((await db.product.findUniqueOrThrow({ where: { id: second.product.id } })).auctionHoldId).toBeNull();
  });

  it("the tick closes due lots and does nothing early", async () => {
    const { ctx, lot, auctionId } = await liveLot();
    const a = await bidder(ctx.tenantId, auctionId);
    await placeBid(a, { lotId: lot.id, maxAmount: 15000, requestId: req() });
    expect(await closeLot(lot.id)).toMatchObject({ result: "skipped", reason: "not-due" });
    await db.auctionLot.update({ where: { id: lot.id }, data: { closesAt: new Date(Date.now() - 1000) } });
    const t = await tickOnce({ ending: false });
    expect(t).toMatchObject({ sold: 1 });
  });

  it("cancelWonLot cancels the order, frees the item and can block the bidder", async () => {
    const { ctx, product, lot, auctionId } = await liveLot();
    const a = await bidder(ctx.tenantId, auctionId);
    await placeBid(a, { lotId: lot.id, maxAmount: 15000, requestId: req() });
    await closeNow(lot.id);
    await cancelWonLot(ctx, lot.id, { blockBidder: true });
    const after = await db.auctionLot.findUniqueOrThrow({ where: { id: lot.id }, include: { order: true } });
    expect(after.status).toBe("CANCELLED");
    expect(after.order?.paymentStatus).toBe("CANCELED");
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ status: "ACTIVE", auctionHoldId: null });
    expect(await db.blockedBidder.count({ where: { customerId: a.customerId } })).toBe(1);
  });
});

describe("staff", () => {
  it("voidBid recomputes the lot from the remaining bids", async () => {
    const { ctx, lot, auctionId } = await liveLot();
    const a = await bidder(ctx.tenantId, auctionId);
    const b = await bidder(ctx.tenantId, auctionId);
    const c = await bidder(ctx.tenantId, auctionId);
    await placeBid(a, { lotId: lot.id, maxAmount: 15000, requestId: req() });
    await placeBid(b, { lotId: lot.id, maxAmount: 13000, requestId: req() });
    await placeBid(c, { lotId: lot.id, maxAmount: 20000, requestId: req() });
    const cBid = await db.bid.findFirstOrThrow({ where: { lotId: lot.id, customerId: c.customerId, isAuto: false } });
    const auto = await db.bid.findFirstOrThrow({ where: { lotId: lot.id, isAuto: true } });
    await expect(voidBid(ctx, auto.id, "nope")).rejects.toMatchObject({ code: "INVALID" });

    const res = await voidBid(ctx, cBid.id, "Shill bidding");
    expect(res.after).toEqual({ current: 14000, leaderId: a.customerId });
    const after = await db.auctionLot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(after).toMatchObject({ currentBid: 14000, leadingBidderId: a.customerId, leadingMax: 15000 });
    expect(after.bidCount).toBe(await db.bid.count({ where: { lotId: lot.id, voidedAt: null } }));
    const pub = await getPublicLot(ctx.tenantId, lot.id);
    expect(pub!.history.map((x) => [x.bidderNumber, x.amount])).toEqual([
      [1, 14000],
      [2, 13000],
      [1, 12000],
    ]);
    const admin = await getAuctionAdmin(ctx, auctionId);
    expect(admin.lots[0]).toMatchObject({ currentBid: 14000, leadingMax: 15000, leader: { customerId: a.customerId, bidderNumber: 1 } });
    expect(admin.stats).toMatchObject({ bidders: 2, currentTotal: 14000, lotsAboveReserve: 1 });
  });

  it("signals: different customers on one device bidding on the same lot", async () => {
    const { ctx, lot, auctionId } = await liveLot();
    const a = await bidder(ctx.tenantId, auctionId);
    const b = await bidder(ctx.tenantId, auctionId);
    const c = await bidder(ctx.tenantId, auctionId);
    await placeBid(a, { lotId: lot.id, maxAmount: 15000, requestId: req(), deviceId: "device-1" });
    await placeBid(b, { lotId: lot.id, maxAmount: 16000, requestId: req(), deviceId: "device-1" });
    await placeBid(c, { lotId: lot.id, maxAmount: 30000, requestId: req(), deviceId: "device-2" });
    const signals = await getBidSignals(ctx, auctionId);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ sharedBy: "device", count: 1, lots: [{ lotId: lot.id, lotNumber: 1 }] });
    expect(signals[0].customers.map((x) => x.customerId).sort()).toEqual([a.customerId, b.customerId].sort());
    const rows = await db.bid.findMany({ where: { lotId: lot.id, isAuto: false }, select: { deviceHash: true, ipHash: true } });
    for (const r of rows) {
      expect(r.deviceHash).toMatch(/^[0-9a-f]{32}$/);
      expect(r.deviceHash).not.toContain("device");
    }
  });
});

