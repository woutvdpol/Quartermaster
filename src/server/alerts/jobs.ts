import { z } from "zod";
import { defineJob } from "@/server/jobs/registry";

/*
 * Alert jobs (registered in src/server/jobs/definitions.ts). Light module: handlers import the
 * heavy code lazily, because enqueue() loads every definition (also inside Next.js).
 */
const id = z.string().min(1).max(64);

const ALERT_QUEUE = { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 10 * 60, deleteAfterSeconds: 24 * 60 * 60 };

/** A product was published / bumped → match it against saved searches. */
export const alertsMatchProductJob = defineJob(
  "alerts.match-product",
  z.object({ tenantId: id, productId: id }),
  async ({ tenantId, productId }) => {
    const { matchProduct } = await import("./matching");
    return matchProduct(tenantId, productId);
  },
  { queue: ALERT_QUEUE, concurrency: 2 },
);

/** A reservation of a product was released / expired → wishlist BACK_AVAILABLE alerts. */
export const alertsBackAvailableJob = defineJob(
  "alerts.back-available",
  z.object({ tenantId: id, productId: id, excludeCustomerId: id.nullable().optional() }),
  async ({ tenantId, productId, excludeCustomerId }) => {
    const { processBackAvailable } = await import("./wishlist-alerts");
    return { mails: await processBackAvailable(tenantId, productId, { excludeCustomerId }) };
  },
  { queue: ALERT_QUEUE, concurrency: 2 },
);

/** The price of a product was lowered → wishlist PRICE_DROP alerts. */
export const alertsPriceDropJob = defineJob(
  "alerts.price-drop",
  z.object({ tenantId: id, productId: id, oldPrice: z.number().int().min(0), newPrice: z.number().int().min(0) }),
  async ({ tenantId, productId, oldPrice, newPrice }) => {
    const { processPriceDrop } = await import("./wishlist-alerts");
    return { mails: await processPriceDrop(tenantId, productId, oldPrice, newPrice) };
  },
  { queue: ALERT_QUEUE, concurrency: 2 },
);

export const ALERT_JOBS = {
  "alerts.match-product": alertsMatchProductJob,
  "alerts.back-available": alertsBackAvailableJob,
  "alerts.price-drop": alertsPriceDropJob,
};

/**
 * Cron tasks (spread into CRON_TASKS in src/server/jobs/cron.ts):
 *   alerts.digest  hourly — DAILY (07:00 tenant time) / WEEKLY (Monday 07:00) digests
 *   alerts.scan    every 5 min — safety net: match recently published products, wishlist
 *                  back-available for recently released reservations, purge expired opt-ins
 */
export const ALERT_CRON_TASKS = {
  "alerts.digest": {
    schedule: "5 * * * *",
    description: "Send due DAILY/WEEKLY saved-search digests (07:00 tenant time; weekly on Mondays).",
    run: async () => {
      const { sendDueDigests } = await import("./matching");
      return sendDueDigests();
    },
  },
  "alerts.scan": {
    schedule: "*/5 * * * *",
    description: "Match recently published products, send back-available wishlist alerts, purge expired alert opt-ins.",
    run: async () => {
      const [{ matchRecentProductsAllTenants }, { scanReleasedReservations }, { purgeExpiredPending }] = await Promise.all([
        import("./matching"),
        import("./wishlist-alerts"),
        import("./saved-searches"),
      ]);
      const matched = await matchRecentProductsAllTenants();
      const released = await scanReleasedReservations();
      const purged = await purgeExpiredPending();
      return { matched, released, purged };
    },
  },
};
