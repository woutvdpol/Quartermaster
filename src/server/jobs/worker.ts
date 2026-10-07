import "server-only";
import type { PgBoss } from "pg-boss";
import { createWorkerBoss } from "./boss";
import { JOBS, cronSchedules, type JobName } from "./definitions";
import { retryLimitOf, type JobDefinition, type JobRunContext } from "./registry";

export type RunningWorker = { boss: PgBoss; stop: (timeoutMs?: number) => Promise<void> };

/**
 * Starts the job worker: makes sure every queue exists with current options, registers handlers
 * and (re)registers the cron schedules. Several worker replicas may run at once (k8s): pg-boss
 * claims jobs with SKIP LOCKED and cron ticks are deduplicated in the database.
 */
export async function startWorker(opts: { only?: JobName[]; cron?: boolean } = {}): Promise<RunningWorker> {
  const boss = createWorkerBoss();
  boss.on("warning", (w) => console.warn("[jobs:worker] warning", w.message));
  await boss.start({ attempts: 10 });

  const names = (Object.keys(JOBS) as JobName[]).filter((n) => !opts.only || opts.only.includes(n));
  for (const name of names) {
    const def = JOBS[name] as unknown as JobDefinition;
    await boss.createQueue(name, def.queue);
    // Apply changed retry/retention options to queues that already exist (createQueue doesn't).
    const q = def.queue;
    const updatable = {
      retryLimit: q.retryLimit,
      retryDelay: q.retryDelay,
      retryBackoff: q.retryBackoff,
      retryDelayMax: q.retryDelayMax,
      expireInSeconds: q.expireInSeconds,
      retentionSeconds: q.retentionSeconds,
      deleteAfterSeconds: q.deleteAfterSeconds,
    };
    await boss.updateQueue(name, Object.fromEntries(Object.entries(updatable).filter(([, v]) => v !== undefined)));
    await boss.work(name, { includeMetadata: true, localConcurrency: def.concurrency }, async ([job]) => {
      const ctx: JobRunContext = {
        jobId: job.id,
        retryCount: job.retryCount,
        retryLimit: job.retryLimit ?? retryLimitOf(def),
        isFinalAttempt: job.retryCount >= (job.retryLimit ?? retryLimitOf(def)),
        signal: job.signal,
      };
      const started = Date.now();
      try {
        const payload = def.schema.parse(job.data);
        const result = await def.handler(payload, ctx);
        if (!name.startsWith("cron.") || process.env.JOBS_LOG_CRON === "1") {
          console.info(`[jobs] ${name} ${job.id} done in ${Date.now() - started}ms`);
        }
        return result;
      } catch (err) {
        console.error(`[jobs] ${name} ${job.id} failed (attempt ${ctx.retryCount + 1}/${ctx.retryLimit + 1})`, err);
        throw err;
      }
    });
  }

  if (opts.cron !== false) {
    const wanted = cronSchedules().filter((s) => names.includes(s.job));
    for (const s of wanted) await boss.schedule(s.job, s.cron, {}, { tz: "UTC" });
    // Remove schedules of cron tasks that no longer exist.
    for (const existing of await boss.getSchedules()) {
      if (existing.name.startsWith("cron.") && !wanted.some((w) => w.job === existing.name)) {
        await boss.unschedule(existing.name, existing.key);
      }
    }
  }

  console.info(`[jobs] worker started: ${names.join(", ")}`);
  return {
    boss,
    stop: async (timeoutMs = 30_000) => {
      // graceful: stop fetching, wait for active handlers (up to timeout), then close the pool.
      await boss.stop({ graceful: true, close: true, timeout: timeoutMs });
    },
  };
}
