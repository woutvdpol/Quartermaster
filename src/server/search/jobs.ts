import { z } from "zod";
import { defineJob } from "@/server/jobs/registry";

/*
 * Search indexing jobs (registered in src/server/jobs/definitions.ts). Light module: handlers import
 * the heavy code (models, sharp) lazily, because enqueue() loads every definition inside Next.js too.
 *
 *   search.embed-product   one product changed (audit hook, ./hooks.ts). Policy "stately" +
 *                          singletonKey = product id: at most one queued + one running per product,
 *                          so a burst of saves collapses into one job (sent with a 5 s delay).
 *   search.reindex-tenant  admin "Rebuild search index" / bulk changes (facet renames, imports).
 *                          Policy "stately" per tenant (one queued + one running: repeated requests
 *                          collapse); continues itself in 4-minute slices.
 */
const id = z.string().min(1).max(64);

export const searchEmbedProductJob = defineJob(
  "search.embed-product",
  z.object({ tenantId: id, productId: id }),
  async ({ tenantId, productId }) => {
    const { indexProducts } = await import("./indexing");
    return indexProducts(tenantId, [productId]);
  },
  { queue: { policy: "stately", retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 5 * 60, deleteAfterSeconds: 24 * 60 * 60 }, concurrency: 2 },
);

export const searchReindexTenantJob = defineJob(
  "search.reindex-tenant",
  z.object({ tenantId: id, after: id.nullable().optional(), force: z.boolean().optional() }),
  async ({ tenantId, after, force }, ctx) => {
    const { runReindexSlice } = await import("./admin");
    return runReindexSlice(tenantId, { after: after ?? null, force: force ?? false, signal: ctx.signal, isFinalAttempt: ctx.isFinalAttempt });
  },
  { queue: { policy: "stately", retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 10 * 60, deleteAfterSeconds: 7 * 24 * 60 * 60 }, concurrency: 1 },
);

export const SEARCH_JOBS = {
  "search.embed-product": searchEmbedProductJob,
  "search.reindex-tenant": searchReindexTenantJob,
};

/**
 * Cron (spread into CRON_TASKS): search.sync every 10 minutes — embeds products the hooks missed
 * (imports, ETL, seeds, direct SQL): no text embedding, edited since, other model, new photo.
 */
export const SEARCH_CRON_TASKS = {
  "search.sync": {
    schedule: "*/10 * * * *",
    description: "Embed products whose search index entry is missing or outdated (max 500 per run).",
    run: async () => {
      const { syncOutdated } = await import("./admin");
      return syncOutdated();
    },
  },
};
