// Background job worker: `npx tsx scripts/worker.ts` (Docker Compose service `worker`, k8s Deployment).
//
// Runs pg-boss maintenance, cron schedules and every job handler (mail, newsletter fan-out, …).
// SIGTERM/SIGINT → stop fetching, let running jobs finish (up to WORKER_SHUTDOWN_TIMEOUT_MS, default
// 25 s — keep it below the pod's terminationGracePeriodSeconds), then exit.
import "../src/server/jobs/node-runtime";

async function main() {
  await import("dotenv/config");
  const { startWorker } = await import("../src/server/jobs/worker");
  const worker = await startWorker({ cron: process.env.WORKER_CRON !== "0" });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.info(`[worker] ${signal} received, shutting down…`);
    const timeout = Number(process.env.WORKER_SHUTDOWN_TIMEOUT_MS ?? 25_000);
    const hardExit = setTimeout(() => {
      console.error("[worker] shutdown timed out, exiting");
      process.exit(1);
    }, timeout + 5_000);
    hardExit.unref();
    try {
      await worker.stop(timeout);
      process.exit(0);
    } catch (err) {
      console.error("[worker] error during shutdown", err);
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] failed to start", err);
  process.exit(1);
});
