import "server-only";
import { timingSafeEqual, createHash } from "node:crypto";
import { ALERT_CRON_TASKS } from "@/server/alerts/jobs";
import { SEARCH_CRON_TASKS } from "@/server/search/jobs";
import { PUSH_CRON_TASKS } from "@/server/push/jobs";
import { TRANSLATION_CRON_TASKS } from "@/server/translations/jobs";
import { COMMERCE_CRON_TASKS } from "./commerce-cron";

/**
 * Recurring maintenance tasks. Each is idempotent and safe to run concurrently with itself, so
 * it can be triggered by the worker's pg-boss schedule *and/or* by an external scheduler
 * (Kubernetes CronJob → `POST /api/cron/<name>` with `Authorization: Bearer $CRON_SECRET`).
 *
 * Imports are lazy so this module stays cheap to load from the route handler.
 */
export type CronTask = {
  /** Cron expression (UTC) used by the worker. */
  schedule: string;
  description: string;
  run: () => Promise<Record<string, unknown>>;
};

export const CRON_TASKS = {
  "reservations.expire": {
    schedule: "* * * * *",
    description: "Flip ACTIVE cart reservations past their expiry to EXPIRED (all tenants).",
    run: async () => {
      const { expireReservations } = await import("@/server/stock/reservations");
      return { expired: await expireReservations() };
    },
  },
  "rate-limit.prune": {
    schedule: "17 * * * *",
    description: "Delete rate-limit hits older than 24 hours.",
    run: async () => {
      const { pruneRateLimitHits } = await import("@/server/auth/rate-limit");
      await pruneRateLimitHits();
      return {};
    },
  },
  "leads.photos.cleanup": {
    schedule: "43 3 * * *",
    description: "Delete lead photo folders without a lead that are older than the 24 h draft lifetime (listable storage only).",
    run: async () => {
      const { cleanupOrphanLeadPhotos } = await import("@/server/leads/cleanup");
      return await cleanupOrphanLeadPhotos();
    },
  },
  // TODO(phase 3): "sitemap.generate" once the storefront sitemap exists (likely app/sitemap.ts + ISR instead).
  ...ALERT_CRON_TASKS, // alerts.digest, alerts.scan
  ...COMMERCE_CRON_TASKS, // offers.expire, cart.abandoned
  ...SEARCH_CRON_TASKS, // search.sync
  ...PUSH_CRON_TASKS, // push.reservations, push.flush
  ...TRANSLATION_CRON_TASKS, // translations.sync
  "rates.refresh": {
    // ECB publishes ~16:00 CET on working days; 15:30 UTC is after that in summer and winter time.
    schedule: "30 15 * * *",
    description: "Fetch the ECB euro reference rates (display currencies only).",
    run: async () => {
      const { refreshRates } = await import("@/server/rates");
      return await refreshRates();
    },
  },
} satisfies Record<string, CronTask>;

export type CronTaskName = keyof typeof CRON_TASKS;

export function isCronTaskName(name: string): name is CronTaskName {
  return Object.hasOwn(CRON_TASKS, name);
}

export async function runCronTask(name: CronTaskName): Promise<Record<string, unknown>> {
  const started = Date.now();
  const result = await CRON_TASKS[name].run();
  return { ...result, ms: Date.now() - started };
}

/**
 * Constant-time check of an `Authorization: Bearer <secret>` header. Both sides are hashed first so
 * the comparison never leaks the secret's length. An unset/short secret disables the endpoint.
 */
export function isAuthorizedCronRequest(authorization: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !authorization) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return false;
  const a = createHash("sha256").update(match[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
