import { z } from "zod";
import { defineJob } from "@/server/jobs/registry";

/*
 * Product import jobs (src/server/import/service.ts). Light definitions; handlers lazy-load the service.
 *   import.run    – create the items of an import job (continues itself in time-boxed slices).
 *   import.images – download the photos of the created items (same slicing).
 * Policy "singleton" + singletonKey = import job id: one active handler per import at a time, so the
 * summary/progress has a single writer. Both handlers are idempotent; on the final failed attempt the
 * import is marked FAILED (it can be retried from the admin).
 */
const id = z.string().min(1).max(64);
const queue = { policy: "singleton", retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 15 * 60, deleteAfterSeconds: 7 * 24 * 60 * 60 } as const;

export const importRunJob = defineJob(
  "import.run",
  z.object({ tenantId: id, jobId: id, cursor: z.int().min(0).optional() }),
  async ({ tenantId, jobId, cursor }, ctx) => {
    const svc = await import("./service");
    const { enqueue } = await import("@/server/jobs/queue");
    try {
      const res = await svc.runImportProducts(tenantId, jobId, { cursor });
      if (!res.done) await enqueue("import.run", { tenantId, jobId, cursor: res.cursor }, { singletonKey: jobId });
      return res;
    } catch (err) {
      if (ctx.isFinalAttempt) await svc.failImport(tenantId, jobId, err instanceof Error ? err.message : String(err));
      throw err;
    }
  },
  { queue, concurrency: 2 },
);

export const importImagesJob = defineJob(
  "import.images",
  z.object({ tenantId: id, jobId: id }),
  async ({ tenantId, jobId }, ctx) => {
    const svc = await import("./service");
    const { enqueue } = await import("@/server/jobs/queue");
    try {
      const res = await svc.runImportImages(tenantId, jobId, { signal: ctx.signal });
      if (!res.done) await enqueue("import.images", { tenantId, jobId }, { singletonKey: jobId });
      return res;
    } catch (err) {
      if (ctx.isFinalAttempt) await svc.failImport(tenantId, jobId, err instanceof Error ? err.message : String(err));
      throw err;
    }
  },
  { queue, concurrency: 2 },
);
