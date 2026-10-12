import { z } from "zod";
import { defineJob } from "@/server/jobs/registry";
import type { CronTask } from "@/server/jobs/cron";

/*
 * Auction jobs (registered in src/server/jobs/definitions.ts; docs/auctions.md). Light module: the
 * handlers import the service lazily (enqueue() loads every definition, also inside Next.js).
 *
 *   auctions.close-lot  queued for each lot's closesAt (again after every extension) — closes it within
 *                       ~2 s of the deadline; idempotent (a no-op when not due or already closed)
 *   auctions.notify     outbid / won / payment reminder (mail + push), off the bidding transaction
 *   cron auctions.tick  every minute, looping every 10 s inside the run: PUBLISHED → LIVE, closing of
 *                       due lots (safety net for missed close-lot jobs), auction → CLOSED, the
 *                       "closes in 5 minutes" pushes and releasing holds of paid lots
 */

export const auctionCloseLotJob = defineJob(
  "auctions.close-lot",
  z.object({ lotId: z.string().min(1).max(64) }),
  async ({ lotId }) => {
    const { closeLot } = await import("./closing");
    return closeLot(lotId);
  },
  { queue: { retryLimit: 5, retryDelay: 5, retryBackoff: true, retryDelayMax: 60, expireInSeconds: 2 * 60, deleteAfterSeconds: 24 * 60 * 60 }, concurrency: 4 },
);

export const auctionNotifyJob = defineJob(
  "auctions.notify",
  z.object({ kind: z.enum(["outbid", "won", "reminder"]), lotId: z.string().min(1).max(64), customerId: z.string().min(1).max(64).optional() }),
  async ({ kind, lotId, customerId }) => {
    const notify = await import("./notify");
    if (kind === "outbid") return customerId ? notify.notifyOutbid(lotId, customerId) : { skipped: "no-customer" };
    if (kind === "won") return notify.notifyWon(lotId);
    return notify.notifyPaymentReminder(lotId);
  },
  { queue: { retryLimit: 3, retryDelay: 20, retryBackoff: true, retryDelayMax: 10 * 60, expireInSeconds: 2 * 60, deleteAfterSeconds: 24 * 60 * 60 }, concurrency: 4 },
);

export const AUCTION_JOBS = {
  "auctions.close-lot": auctionCloseLotJob,
  "auctions.notify": auctionNotifyJob,
};

/** Spread into CRON_TASKS in src/server/jobs/cron.ts. */
export const AUCTION_CRON_TASKS = {
  "auctions.tick": {
    schedule: "* * * * *",
    description: "Auctions: open published auctions, close due lots (every 10 s within the minute), close finished auctions, 'closes in 5 minutes' pushes, release holds of paid lots.",
    run: async () => {
      const { runAuctionTicks } = await import("./closing");
      return runAuctionTicks();
    },
  },
} satisfies Record<string, CronTask>;
