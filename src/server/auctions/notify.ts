import "server-only";
import { db } from "@/server/db";
import { take } from "@/server/auth/rate-limit";
import { queueMail } from "@/server/mail/queue";
import { pushRecipients, queuePush } from "@/server/push/service";
import { dedupeKeys } from "@/server/push/rules";
import { formatMoney } from "@/components/shop/ui/money";
import { AUCTION_PATHS } from "./paths";
import { payToken } from "./shared";

/*
 * Auction notifications (docs/auctions.md § Meldingen). Run from the `auctions.notify` job and the tick,
 * never inside the bidding transaction.
 *
 *  - AUCTION_OUTBID: push (urgent, TTL until the close) + mail to the displaced leader. At most one per
 *    lot per customer per 2 minutes (rate-limit table), and only while they are still outbid and the
 *    lot is open — a bidding war doesn't spam.
 *  - AUCTION_ENDING: push only, ~5 minutes before the close, to everyone who bid on the lot; once per lot.
 *  - AUCTION_WON: mail + push with the personal payment link. Reminder mail after 3 days if unpaid.
 * Quiet hours / cap: see src/server/push/rules.ts (live auction pushes only break quiet hours for
 * customers who bid in the last 30 minutes; auction pushes never count toward the daily cap).
 */

export const OUTBID_DEDUPE_MS = 2 * 60 * 1000;
/** "Closes soon" push: lots closing within this window… */
export const ENDING_WINDOW_MS = 5 * 60 * 1000;
/** …but not when less than this is left. */
export const ENDING_MIN_LEFT_MS = 30 * 1000;

export const auctionPushCopy = {
  outbid: (p: { title: string; current: number; currency: string }) => ({
    title: `You've been outbid: ${p.title}`,
    body: `The bid is now ${formatMoney(p.current, p.currency)}. Raise your maximum to stay in.`,
  }),
  ending: (p: { title: string; minutes: number; leading: boolean }) => ({
    title: `Closing in ${p.minutes} minute${p.minutes === 1 ? "" : "s"}: ${p.title}`,
    body: p.leading ? "You are the highest bidder right now." : "You are not the highest bidder. Bid now to stay in.",
  }),
  won: (p: { title: string; amount: number; currency: string; payDays: number }) => ({
    title: `You won ${p.title}`,
    body: `Hammer price ${formatMoney(p.amount, p.currency)}. Please pay within ${p.payDays} days.`,
  }),
};

async function safely<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[auctions] ${what} failed`, err);
    return null;
  }
}

export async function notifyOutbid(lotId: string, customerId: string): Promise<{ push: boolean; mail: boolean } | { skipped: string }> {
  const lot = await db.auctionLot.findUnique({
    where: { id: lotId },
    select: { id: true, tenantId: true, status: true, closesAt: true, currentBid: true, leadingBidderId: true, product: { select: { title: true } }, tenant: { select: { currency: true } } },
  });
  if (!lot) return { skipped: "not-found" };
  if (lot.status !== "OPEN" || lot.closesAt.getTime() <= Date.now()) return { skipped: "closed" };
  if (lot.leadingBidderId === customerId) return { skipped: "leading-again" };
  if (!(await take(`auction.outbid:${lot.id}:${customerId}`, { limit: 1, windowMs: OUTBID_DEDUPE_MS }))) return { skipped: "deduped" };

  const push = await safely("outbid push", async () => {
    const to = await pushRecipients(lot.tenantId, [customerId]);
    if (!to.size) return false;
    const text = auctionPushCopy.outbid({ title: lot.product.title, current: lot.currentBid ?? 0, currency: lot.tenant.currency });
    return queuePush({ tenantId: lot.tenantId, customerId, kind: "AUCTION_OUTBID", ...text, url: AUCTION_PATHS.lot(lot.id), dedupeKey: dedupeKeys.auctionOutbid(lot.id, new Date()) });
  });
  await queueMail({ tenantId: lot.tenantId, template: "auction-outbid", props: { lotId: lot.id, customerId } });
  return { push: !!push, mail: true };
}

async function wonLot(lotId: string) {
  return db.auctionLot.findUnique({
    where: { id: lotId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      currentBid: true,
      leadingBidderId: true,
      orderId: true,
      product: { select: { title: true } },
      auction: { select: { payDays: true } },
      tenant: { select: { currency: true } },
      order: { select: { paymentStatus: true, canceledAt: true, finalizedAt: true } },
    },
  });
}

export async function notifyWon(lotId: string): Promise<{ push: boolean; mail: boolean } | { skipped: string }> {
  const lot = await wonLot(lotId);
  if (!lot || lot.status !== "SOLD" || !lot.orderId || !lot.leadingBidderId || !lot.order) return { skipped: "not-sold" };
  if (lot.order.canceledAt) return { skipped: "cancelled" };
  const customerId = lot.leadingBidderId;
  const orderId = lot.orderId;
  const push = await safely("won push", async () => {
    const to = await pushRecipients(lot.tenantId, [customerId]);
    if (!to.size) return false;
    const text = auctionPushCopy.won({ title: lot.product.title, amount: lot.currentBid ?? 0, currency: lot.tenant.currency, payDays: lot.auction.payDays });
    return queuePush({
      tenantId: lot.tenantId,
      customerId,
      kind: "AUCTION_WON",
      ...text,
      url: AUCTION_PATHS.pay(payToken(lot.tenantId, lot.id, orderId)),
      dedupeKey: dedupeKeys.auctionWon(lot.id),
    });
  });
  await queueMail({ tenantId: lot.tenantId, template: "auction-won", props: { lotId: lot.id } });
  return { push: !!push, mail: true };
}

export async function notifyPaymentReminder(lotId: string): Promise<{ mail: boolean } | { skipped: string }> {
  const lot = await wonLot(lotId);
  if (!lot || lot.status !== "SOLD" || !lot.order) return { skipped: "not-sold" };
  if (lot.order.canceledAt || lot.order.finalizedAt || ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(lot.order.paymentStatus)) return { skipped: "settled" };
  await queueMail({ tenantId: lot.tenantId, template: "auction-payment-reminder", props: { lotId: lot.id } });
  return { mail: true };
}

/**
 * Tick: "closes in 5 minutes" pushes (once per lot per bidder with push). `tenantIds` limits the scan to
 * shops with the auctions module (the push invites bidding, which needs the module).
 */
export async function scanEndingLots(now = new Date(), tenantIds?: ReadonlySet<string>): Promise<{ lots: number; queued: number }> {
  if (tenantIds && !tenantIds.size) return { lots: 0, queued: 0 };
  const lots = await db.auctionLot.findMany({
    where: {
      ...(tenantIds ? { tenantId: { in: [...tenantIds] } } : {}),
      status: "OPEN",
      closesAt: { gt: new Date(now.getTime() + ENDING_MIN_LEFT_MS), lte: new Date(now.getTime() + ENDING_WINDOW_MS) },
      auction: { status: "LIVE" },
      bids: { some: { voidedAt: null } },
    },
    select: { id: true, tenantId: true, closesAt: true, leadingBidderId: true, product: { select: { title: true } } },
    take: 500,
  });
  let queued = 0;
  for (const lot of lots) {
    await safely("ending push", async () => {
      const bidders = await db.bid.findMany({ where: { lotId: lot.id, voidedAt: null }, distinct: ["customerId"], select: { customerId: true } });
      const to = await pushRecipients(
        lot.tenantId,
        bidders.map((b) => b.customerId),
      );
      const minutes = Math.max(1, Math.round((lot.closesAt.getTime() - now.getTime()) / 60_000));
      for (const customerId of to) {
        const text = auctionPushCopy.ending({ title: lot.product.title, minutes, leading: lot.leadingBidderId === customerId });
        const ok = await queuePush({ tenantId: lot.tenantId, customerId, kind: "AUCTION_ENDING", ...text, url: AUCTION_PATHS.lot(lot.id), dedupeKey: dedupeKeys.auctionEnding(lot.id) });
        if (ok) queued++;
      }
    });
  }
  return { lots: lots.length, queued };
}
