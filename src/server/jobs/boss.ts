import "server-only";
import { PgBoss } from "pg-boss";

/**
 * pg-boss lives in its own schema ("pgboss") of the application database, so jobs can be
 * created in the same transaction as domain writes (see `enqueue(..., { tx })`).
 *
 * Two kinds of instances:
 *  - producer (`getBoss()`): used by the web app and services to send jobs. No supervision,
 *    no cron timekeeping — those belong to the worker.
 *  - worker (`createWorkerBoss()`): runs maintenance, cron schedules and job handlers.
 */
export const BOSS_SCHEMA = "pgboss";

const globalForBoss = globalThis as unknown as { qmBoss?: Promise<PgBoss> };

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

function logErrors(boss: PgBoss, label: string) {
  boss.on("error", (err) => console.error(`[jobs:${label}]`, err));
  return boss;
}

/** Shared producer instance (one per process, survives dev hot reloads). */
export function getBoss(): Promise<PgBoss> {
  globalForBoss.qmBoss ??= (async () => {
    const boss = logErrors(
      new PgBoss({
        connectionString: connectionString(),
        schema: BOSS_SCHEMA,
        application_name: "quartermaster-web",
        max: 3,
        supervise: false,
        schedule: false,
        instanceName: "web",
      }),
      "producer",
    );
    return boss.start({ attempts: 3 });
  })().catch((err) => {
    globalForBoss.qmBoss = undefined; // allow a retry on the next call
    throw err;
  });
  return globalForBoss.qmBoss;
}

/** A full instance for the worker process: maintenance + cron + handlers. */
export function createWorkerBoss(): PgBoss {
  return logErrors(
    new PgBoss({
      connectionString: connectionString(),
      schema: BOSS_SCHEMA,
      application_name: "quartermaster-worker",
      max: 10,
      supervise: true,
      schedule: true,
      instanceName: "worker",
    }),
    "worker",
  );
}

/** Stops the shared producer (tests, graceful shutdown). */
export async function stopBoss(): Promise<void> {
  const pending = globalForBoss.qmBoss;
  globalForBoss.qmBoss = undefined;
  if (pending) await (await pending.catch(() => null))?.stop({ graceful: false, close: true });
}
