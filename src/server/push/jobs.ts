import { z } from "zod";
import { defineJob } from "@/server/jobs/registry";
import type { CronTask } from "@/server/jobs/cron";

/*
 * Push jobs (registered in src/server/jobs/definitions.ts; docs/push.md). Light module: handlers
 * import the heavy code (web-push) lazily, because enqueue() loads every definition (also inside Next.js).
 */

/** Deliver one PushMessage to every device of its customer (quiet hours / cap applied at send time). */
export const pushSendJob = defineJob(
  "push.send",
  z.object({ messageId: z.string().min(1).max(64) }),
  async ({ messageId }) => {
    const { sendPushMessage } = await import("./send");
    return sendPushMessage(messageId);
  },
  // Short retries: a push that arrives an hour late is mostly noise (the flush cron catches orphans).
  { queue: { retryLimit: 3, retryDelay: 20, retryBackoff: true, retryDelayMax: 10 * 60, expireInSeconds: 2 * 60, deleteAfterSeconds: 24 * 60 * 60 }, concurrency: 4 },
);

export const PUSH_JOBS = {
  "push.send": pushSendJob,
};

/**
 * Cron tasks (spread into CRON_TASKS in src/server/jobs/cron.ts):
 *   push.reservations  every minute — "your reservation ends soon" for logged-in customers
 *   push.flush         every 5 min — re-queue pushes held back by quiet hours / the daily cap
 */
export const PUSH_CRON_TASKS = {
  "push.reservations": {
    schedule: "* * * * *",
    description: "Push 'your reservation ends soon' (~3 min before the hold lapses) to logged-in customers with push on.",
    run: async () => {
      const { scanEndingReservations } = await import("./reservations");
      return scanEndingReservations();
    },
  },
  "push.flush": {
    schedule: "*/5 * * * *",
    description: "Re-queue push alerts held back by quiet hours or the daily cap; drop stale ones.",
    run: async () => {
      const { flushQueuedPush } = await import("./send");
      return flushQueuedPush();
    },
  },
} satisfies Record<string, CronTask>;
