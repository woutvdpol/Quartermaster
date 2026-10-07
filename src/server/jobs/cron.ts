import "server-only";
import { timingSafeEqual, createHash } from "node:crypto";

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
  // TODO(phase 3): "sitemap.generate" once the storefront sitemap exists (likely app/sitemap.ts + ISR instead).
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
