import { z } from "zod";
import { defineJob } from "@/server/jobs/registry";

/*
 * Translation jobs (registered in src/server/jobs/definitions.ts). Light module: handlers import the
 * DB code lazily (enqueue() loads every definition inside Next.js too).
 *
 *   translations.sync       an entity changed (audit hook, ./hooks.ts; singleton per entity, 5 s
 *                           debounce) or a whole tenant ("Translate existing stock", imports).
 *                           Upserts Translation rows (QUEUED) and starts translations.translate.
 *   translations.translate  QUEUED → MACHINE through the embedder, per tenant (stately singleton:
 *                           one running + one queued), 4-minute slices that continue themselves.
 *                           Embedder down → retries with backoff; the hourly cron nudges it again.
 */
const id = z.string().min(1).max(64);
const entity = z.enum(["PRODUCT", "CATEGORY", "FACET", "FACET_VALUE", "CONTENT_PAGE", "MENU_ITEM"]);

export const translationsSyncJob = defineJob(
  "translations.sync",
  z.object({
    tenantId: id,
    entity: entity.optional(),
    entityIds: z.array(id).max(500).optional(),
    scope: z.enum(["stock", "all", "recent"]).optional(),
  }),
  async ({ tenantId, entity, entityIds, scope }, ctx) => {
    const { syncEntity, syncTenant } = await import("./sync");
    if (entity && entityIds) return syncEntity(tenantId, entity, entityIds);
    return syncTenant(tenantId, scope ?? "stock", { signal: ctx.signal });
  },
  { queue: { policy: "stately", retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 15 * 60, deleteAfterSeconds: 24 * 60 * 60 }, concurrency: 2 },
);

export const translationsTranslateJob = defineJob(
  "translations.translate",
  z.object({ tenantId: id }),
  async ({ tenantId }, ctx) => {
    const { processQueue } = await import("./machine");
    return processQueue(tenantId, { signal: ctx.signal });
  },
  {
    queue: { policy: "stately", retryLimit: 6, retryDelay: 60, retryBackoff: true, retryDelayMax: 60 * 60, expireInSeconds: 10 * 60, deleteAfterSeconds: 7 * 24 * 60 * 60 },
    concurrency: 1,
  },
);

export const TRANSLATION_JOBS = {
  "translations.sync": translationsSyncJob,
  "translations.translate": translationsTranslateJob,
};

/**
 * Cron (spread into CRON_TASKS): translations.sync hourly — picks up changes the hooks missed
 * (imports, ETL, direct SQL; last 2 hours), removes rows of deleted entities and restarts the
 * translate job for tenants with queued rows (e.g. after the embedder was down).
 */
export const TRANSLATION_CRON_TASKS = {
  "translations.sync": {
    schedule: "23 * * * *",
    description: "Queue translations for recently changed texts, prune deleted entities, resume translating (tenants with shop languages).",
    run: async () => {
      const { syncAllTenants } = await import("./cron");
      return syncAllTenants();
    },
  },
};
