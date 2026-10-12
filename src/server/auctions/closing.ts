import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { nextSequenceValue } from "@/server/sequence";
import { variantKey } from "@/server/media/product-images";
import { enqueue } from "@/server/jobs/queue";
import { tenantsWithModule } from "@/server/modules";
import { closesAsSold } from "./engine";
import { auctionChannel, notifyLot, DAY_MS, type Tx } from "./shared";
import { scanEndingLots } from "./notify";

/*
 * Status transitions and closing (docs/auctions.md § Sluiten).
 *
 *  - closeLot: same row lock as bidding (FOR UPDATE), idempotent (only OPEN lots whose closesAt has
 *    passed on the database clock). A bid that committed before the lock was granted may have moved
 *    closesAt — the lot is then simply not due yet.
 *      SOLD   (a bid ≥ reserve): a PENDING order (channel AUCTION) for the hammer price is created for
 *             the winner; the product keeps its auctionHoldId (hidden, not reservable by anyone) until
 *             the order is paid or cancelled. The winner gets mail + push with the personal payment
 *             link; a reminder job is queued for 3 days later.
 *      UNSOLD (no bid / reserve not met): the hold is cleared — the product is back in the webshop.
 *    The auction becomes CLOSED with its last open lot.
 *  - runAuctionTicks (cron every minute, ticking every 10 s): PUBLISHED → LIVE at opensAt, closing of due
 *    lots (safety net next to the per-lot close jobs), CLOSED auctions, "closes in 5 minutes" pushes,
 *    and hold bookkeeping of won lots (paid → hold released; order cancelled elsewhere → lot CANCELLED).
 */

/** Days after the close at which the payment reminder goes out. */
export const PAYMENT_REMINDER_DAYS = 3;

export type CloseLotResult =
  | { lotId: string; result: "SOLD"; orderId: string; amount: number }
  | { lotId: string; result: "UNSOLD" }
  | { lotId: string; result: "skipped"; reason: "not-found" | "not-open" | "not-due" };

async function dbNow(tx: Tx): Promise<Date> {
  const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  return now instanceof Date ? now : new Date(now);
}

/** Creates the winner's PENDING order (channel AUCTION) for the hammer price. Shipping is chosen on the payment page. */
async function createWinnerOrder(
  tx: Tx,
  lot: { id: string; tenantId: string; auctionId: string; lotNumber: number; productId: string; currentBid: number; leadingBidderId: string },
  now: Date,
) {
  const [customer, product, tenant, cover] = await Promise.all([
    tx.customer.findUniqueOrThrow({ where: { id: lot.leadingBidderId }, select: { id: true, email: true, firstName: true, lastName: true, phone: true } }),
    tx.product.findUniqueOrThrow({ where: { id: lot.productId }, select: { id: true, title: true, stockCode: true, sku: true, purchasePrice: true, weightGrams: true } }),
    tx.tenant.findUniqueOrThrow({ where: { id: lot.tenantId }, select: { currency: true } }),
    tx.productImage.findFirst({ where: { tenantId: lot.tenantId, productId: lot.productId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { storageKey: true } }),
  ]);
  const number = await nextSequenceValue(tx, lot.tenantId, "order.number");
  const order = await tx.order.create({
    data: {
      tenantId: lot.tenantId,
      number,
      customerId: customer.id,
      email: customer.email,
      customerName: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.email,
      phone: customer.phone,
      currency: tenant.currency,
      subtotal: lot.currentBid,
      total: lot.currentBid,
      channel: "AUCTION",
      paymentStatus: "PENDING",
      shippingWeightGrams: product.weightGrams,
      placedAt: now,
      lines: {
        create: [
          {
            tenantId: lot.tenantId,
            productId: product.id,
            title: product.title,
            stockCode: product.stockCode,
            sku: product.sku,
            imagePath: cover ? variantKey(cover.storageKey, "thumb") : null,
            unitPrice: lot.currentBid,
            quantity: 1,
            lineTotal: lot.currentBid,
            purchasePriceSnapshot: product.purchasePrice,
          },
        ],
      },
    },
    select: { id: true, number: true },
  });
  await tx.orderEvent.create({
    data: { tenantId: lot.tenantId, orderId: order.id, type: "created", data: { source: "auction", auctionId: lot.auctionId, lotId: lot.id, lotNumber: lot.lotNumber, hammer: lot.currentBid } },
  });
  return order;
}

/** Closes one lot when due (idempotent). Called by the close-lot job and the tick. */
export async function closeLot(lotId: string): Promise<CloseLotResult> {
  const res = await db.$transaction(
    async (tx): Promise<CloseLotResult & { tenantId?: string; auctionId?: string; auctionClosed?: boolean }> => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM auction_lots WHERE id = ${lotId} FOR UPDATE`;
      if (!rows.length) return { lotId, result: "skipped", reason: "not-found" };
      const now = await dbNow(tx);
      const lot = await tx.auctionLot.findUniqueOrThrow({ where: { id: lotId }, include: { auction: { select: { id: true, status: true } } } });
      if (lot.status !== "OPEN") return { lotId, result: "skipped", reason: "not-open" };
      if (lot.closesAt.getTime() > now.getTime()) return { lotId, result: "skipped", reason: "not-due" };

      let out: CloseLotResult;
      if (closesAsSold(lot.currentBid, lot.leadingBidderId, lot.reservePrice)) {
        const order = await createWinnerOrder(tx, { ...lot, currentBid: lot.currentBid!, leadingBidderId: lot.leadingBidderId! }, now);
        await tx.auctionLot.update({ where: { id: lot.id }, data: { status: "SOLD", closedAt: now, orderId: order.id } });
        // The hold stays: hidden and not reservable until the winner pays (or staff cancel).
        await tx.product.updateMany({ where: { id: lot.productId, tenantId: lot.tenantId, auctionHoldId: null }, data: { auctionHoldId: lot.auctionId } });
        await enqueue("auctions.notify", { kind: "won", lotId: lot.id }, { tx });
        await enqueue("auctions.notify", { kind: "reminder", lotId: lot.id }, { tx, startAfter: new Date(now.getTime() + PAYMENT_REMINDER_DAYS * DAY_MS) });
        out = { lotId, result: "SOLD", orderId: order.id, amount: lot.currentBid! };
      } else {
        await tx.auctionLot.update({ where: { id: lot.id }, data: { status: "UNSOLD", closedAt: now } });
        // Unsold → straight back to the webshop (owner decision).
        await tx.product.updateMany({ where: { id: lot.productId, tenantId: lot.tenantId, auctionHoldId: lot.auctionId }, data: { auctionHoldId: null } });
        out = { lotId, result: "UNSOLD" };
      }
      const auctionClosed = await closeAuctionIfDone(tx, lot.auctionId, now);
      await notifyLot(tx, lot.auctionId, lot.id);
      return { ...out, tenantId: lot.tenantId, auctionId: lot.auctionId, auctionClosed };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
  if (res.result !== "skipped") {
    const { tenantId, auctionId, auctionClosed, ...result } = res;
    await audit({ action: "auction.lot.close", tenantId, entity: "AuctionLot", entityId: lotId, data: { ...result, auctionId: auctionId ?? null } });
    if (auctionClosed) await audit({ action: "auction.close", tenantId, entity: "Auction", entityId: auctionId });
    return result as CloseLotResult;
  }
  return res;
}

/** LIVE (or PUBLISHED) auction without OPEN lots → CLOSED. Returns whether it changed. */
async function closeAuctionIfDone(tx: Tx, auctionId: string, now: Date): Promise<boolean> {
  const open = await tx.auctionLot.count({ where: { auctionId, status: "OPEN" } });
  if (open > 0) return false;
  const closed = await tx.auction.updateMany({ where: { id: auctionId, status: { in: ["LIVE", "PUBLISHED"] } }, data: { status: "CLOSED", closedAt: now } });
  return closed.count > 0;
}

/**
 * PUBLISHED auctions whose opensAt passed → LIVE — only for shops with the auctions module (opening is new
 * activity). A published auction of a shop without it stays PUBLISHED; closeDueLots still closes its lots.
 */
async function openDueAuctions(now: Date, entitled: ReadonlySet<string>): Promise<number> {
  if (!entitled.size) return 0;
  const due = await db.auction.findMany({ where: { status: "PUBLISHED", opensAt: { lte: now }, tenantId: { in: [...entitled] } }, select: { id: true, tenantId: true }, take: 200 });
  let opened = 0;
  for (const a of due) {
    const res = await db.$transaction(async (tx) => {
      const r = await tx.auction.updateMany({ where: { id: a.id, status: "PUBLISHED" }, data: { status: "LIVE" } });
      if (r.count) await tx.$executeRaw`SELECT pg_notify(${auctionChannel(a.id)}, ${JSON.stringify({ auction: "LIVE" })})`;
      return r.count;
    });
    if (res) {
      opened++;
      await audit({ action: "auction.open", tenantId: a.tenantId, entity: "Auction", entityId: a.id });
    }
  }
  return opened;
}

/** Closes every due OPEN lot (oldest deadline first). */
async function closeDueLots(now: Date): Promise<{ sold: number; unsold: number }> {
  const due = await db.auctionLot.findMany({
    where: { status: "OPEN", closesAt: { lte: now }, auction: { status: { in: ["LIVE", "PUBLISHED"] } } },
    orderBy: { closesAt: "asc" },
    select: { id: true },
    take: 200,
  });
  let sold = 0;
  let unsold = 0;
  for (const l of due) {
    try {
      const r = await closeLot(l.id);
      if (r.result === "SOLD") sold++;
      else if (r.result === "UNSOLD") unsold++;
    } catch (err) {
      console.error(`[auctions] closing lot ${l.id} failed`, err);
    }
  }
  return { sold, unsold };
}

/** Auctions left LIVE without open lots (e.g. every lot removed) → CLOSED. */
async function closeEmptyAuctions(now: Date): Promise<number> {
  const rows = await db.auction.findMany({ where: { status: "LIVE", lots: { none: { status: "OPEN" } } }, select: { id: true, tenantId: true }, take: 200 });
  let n = 0;
  for (const a of rows) {
    if (await db.$transaction((tx) => closeAuctionIfDone(tx, a.id, now))) {
      n++;
      await audit({ action: "auction.close", tenantId: a.tenantId, entity: "Auction", entityId: a.id });
    }
  }
  return n;
}

/**
 * Hold bookkeeping of won lots: a paid (finalized) order releases the product's auction hold (it is
 * SOLD now); an order cancelled outside the auction screens (orders admin) cancels the lot and puts the
 * product back in the shop.
 */
export async function reconcileWonLots(): Promise<{ released: number; cancelled: number }> {
  const released = await db.$executeRaw`
    UPDATE products p SET "auctionHoldId" = NULL, "updatedAt" = now()
    FROM auction_lots l JOIN orders o ON o.id = l."orderId"
    WHERE l.status = 'SOLD' AND p.id = l."productId" AND p."auctionHoldId" = l."auctionId" AND o."finalizedAt" IS NOT NULL`;
  const dead = await db.auctionLot.findMany({
    where: { status: "SOLD", order: { canceledAt: { not: null }, finalizedAt: null } },
    select: { id: true, tenantId: true, auctionId: true, productId: true },
    take: 200,
  });
  for (const l of dead) {
    await db.$transaction(async (tx) => {
      await tx.auctionLot.updateMany({ where: { id: l.id, status: "SOLD" }, data: { status: "CANCELLED" } });
      await tx.product.updateMany({ where: { id: l.productId, auctionHoldId: l.auctionId }, data: { auctionHoldId: null } });
      await notifyLot(tx, l.auctionId, l.id);
    });
    await audit({ action: "auction.lot.cancel", tenantId: l.tenantId, entity: "AuctionLot", entityId: l.id, data: { reason: "order cancelled" } });
  }
  return { released, cancelled: dead.length };
}

/**
 * One pass of the scheduler (tests call this directly).
 * Module gating (docs/modules.md § Jobs en crons): opening auctions and the "closes in 5 minutes" pushes
 * (both invite new bidding) only run for shops with the auctions module. Closing due lots, closing empty
 * auctions and the hold bookkeeping of won lots run for every shop, so auctions that were already running
 * when the module went away still finish and their winners can pay.
 */
export async function tickOnce(opts: { now?: Date; ending?: boolean } = {}) {
  const now = opts.now ?? new Date();
  const entitled = await tenantsWithModule("auctions");
  const opened = await openDueAuctions(now, entitled);
  const closed = await closeDueLots(now);
  const emptied = await closeEmptyAuctions(now);
  const ending = opts.ending === false ? { lots: 0, queued: 0 } : await scanEndingLots(now, entitled);
  const won = opts.ending === false ? { released: 0, cancelled: 0 } : await reconcileWonLots();
  return { opened, ...closed, emptied, endingQueued: ending.queued, holdsReleased: won.released, wonCancelled: won.cancelled };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cron `auctions.tick` (every minute): runs tickOnce every 10 s for ~50 s, so lots close within
 * ~10 s even when their close job was lost. The per-minute work (ending pushes, holds) runs once.
 */
export async function runAuctionTicks(opts: { periodMs?: number; budgetMs?: number } = {}): Promise<Record<string, number>> {
  const period = opts.periodMs ?? 10_000;
  const budget = opts.budgetMs ?? 50_000;
  const started = Date.now();
  const total: Record<string, number> = {};
  for (let i = 0; ; i++) {
    const r = await tickOnce({ ending: i === 0 });
    for (const [k, v] of Object.entries(r)) total[k] = (total[k] ?? 0) + v;
    const nextAt = started + (i + 1) * period;
    if (nextAt - started > budget) break;
    const wait = nextAt - Date.now();
    if (wait > 0) await sleep(wait);
  }
  return total;
}
