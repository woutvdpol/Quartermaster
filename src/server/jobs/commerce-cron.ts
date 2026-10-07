import type { CronTask } from "./cron";

/** Commerce cron tasks (phase 5), spread into CRON_TASKS in ./cron.ts. Lazy imports keep this light. */
export const COMMERCE_CRON_TASKS = {
  "offers.expire": {
    schedule: "7 * * * *",
    description: "Expire unanswered offers (72 h) and run-out offer links; revert offers whose order died unpaid.",
    run: async () => {
      const { expireOffers } = await import("@/server/offers");
      return await expireOffers();
    },
  },
  "cart.abandoned": {
    schedule: "37 * * * *",
    description: "One abandoned-cart reminder per consenting cart idle for 2–24 hours.",
    run: async () => {
      const { sendAbandonedCartReminders } = await import("@/server/cart/abandoned");
      return await sendAbandonedCartReminders();
    },
  },
} satisfies Record<string, CronTask>;
