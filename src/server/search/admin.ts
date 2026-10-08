import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { enqueue } from "@/server/jobs/queue";
import type { ServiceContext } from "@/server/context";
import { IMAGE_MODEL, TEXT_MODEL } from "./embedder";
import { findOutdated, indexStatus, reindexTenant, type IndexStatus } from "./indexing";

/*
 * Search index administration: the "Rebuild search index" action (Settings → Catalog) with
 * progress, the job slice that does the work, and the cron safety net.
 */

export type SearchIndexRunDto = {
  status: "queued" | "running" | "done" | "failed";
  force: boolean;
  total: number;
  done: number;
  textEmbedded: number;
  imageEmbedded: number;
  failed: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type SearchIndexOverview = { status: IndexStatus; run: SearchIndexRunDto | null };

const SLICE_MS = 4 * 60 * 1000;
/** A queued/running run without progress for this long is considered dead (worker gone). */
const STALE_MS = 15 * 60 * 1000;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toDto(r: NonNullable<Awaited<ReturnType<typeof db.searchIndexRun.findUnique>>>): SearchIndexRunDto {
  return {
    status: r.status as SearchIndexRunDto["status"],
    force: r.force,
    total: r.total,
    done: r.done,
    textEmbedded: r.textEmbedded,
    imageEmbedded: r.imageEmbedded,
    failed: r.failed,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
  };
}

/** Coverage of the index + the latest rebuild (admin card). Staff of the tenant only (caller checks). */
export async function getSearchIndexOverview(ctx: ServiceContext): Promise<SearchIndexOverview> {
  const [status, run] = await Promise.all([
    indexStatus(ctx.tenantId, { text: TEXT_MODEL.key, image: IMAGE_MODEL.key }),
    db.searchIndexRun.findUnique({ where: { tenantId: ctx.tenantId } }),
  ]);
  return { status, run: run ? toDto(run) : null };
}

/**
 * Queues a rebuild. Idempotent while one is queued/running (returns the existing run). `force`
 * re-embeds everything (after a model change); otherwise only changed products are embedded.
 */
export async function requestReindex(ctx: ServiceContext, opts: { force?: boolean } = {}): Promise<SearchIndexRunDto> {
  const existing = await db.searchIndexRun.findUnique({ where: { tenantId: ctx.tenantId } });
  const active = existing && (existing.status === "queued" || existing.status === "running") && Date.now() - existing.updatedAt.getTime() < STALE_MS;
  if (active) return toDto(existing);
  const total = await db.product.count({ where: { tenantId: ctx.tenantId } });
  const run = await db.searchIndexRun.upsert({
    where: { tenantId: ctx.tenantId },
    create: { tenantId: ctx.tenantId, status: "queued", force: !!opts.force, total, requestedById: ctx.actor.id },
    update: {
      status: "queued",
      force: !!opts.force,
      total,
      done: 0,
      textEmbedded: 0,
      imageEmbedded: 0,
      failed: 0,
      error: null,
      requestedById: ctx.actor.id,
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
    },
  });
  await enqueue("search.reindex-tenant", { tenantId: ctx.tenantId, after: null, force: !!opts.force }, { singletonKey: ctx.tenantId });
  await audit({ action: "search.reindex", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Tenant", entityId: ctx.tenantId, data: { force: !!opts.force, total } });
  return toDto(run);
}

/**
 * Job handler (search.reindex-tenant): one time-boxed slice; re-enqueues itself with the cursor.
 * Also runs for hook-triggered rebuilds (taxonomy changes) without an admin run record.
 */
export async function runReindexSlice(
  tenantId: string,
  opts: { after: string | null; force: boolean; signal?: AbortSignal; isFinalAttempt?: boolean },
): Promise<{ done: boolean; cursor: string | null; processed: number }> {
  const run = await db.searchIndexRun.findUnique({ where: { tenantId } });
  const tracked = !!run && (run.status === "queued" || run.status === "running");
  if (tracked && run.status === "queued") await db.searchIndexRun.update({ where: { tenantId }, data: { status: "running", startedAt: new Date() } });
  // Counters are cumulative over slices: write base + this slice's progress after every batch.
  const base = { done: run?.done ?? 0, textEmbedded: run?.textEmbedded ?? 0, imageEmbedded: run?.imageEmbedded ?? 0, failed: run?.failed ?? 0 };
  const counters = (p: { done: number; textEmbedded: number; imageEmbedded: number; failed: number }) => ({
    done: base.done + p.done,
    textEmbedded: base.textEmbedded + p.textEmbedded,
    imageEmbedded: base.imageEmbedded + p.imageEmbedded,
    failed: base.failed + p.failed,
  });
  try {
    const res = await reindexTenant(tenantId, {
      after: opts.after,
      force: opts.force,
      deadline: Date.now() + SLICE_MS,
      signal: opts.signal,
      onProgress: tracked ? async (p) => void (await db.searchIndexRun.update({ where: { tenantId }, data: { ...counters(p), total: p.total } })) : undefined,
    });
    if (tracked) {
      await db.searchIndexRun.update({
        where: { tenantId },
        data: { ...counters(res), total: res.total, ...(res.finished ? { status: "done", finishedAt: new Date() } : {}) },
      });
    }
    if (!res.finished) await enqueue("search.reindex-tenant", { tenantId, after: res.cursor, force: opts.force }, { singletonKey: tenantId });
    return { done: res.finished, cursor: res.cursor, processed: res.done };
  } catch (err) {
    if (tracked && opts.isFinalAttempt !== false) {
      await db.searchIndexRun.update({ where: { tenantId }, data: { status: "failed", error: (err instanceof Error ? err.message : String(err)).slice(0, 500), finishedAt: new Date() } });
    }
    throw err;
  }
}

/** Cron safety net: queues embed jobs for products the hooks missed. Runs fine in the web process. */
export async function syncOutdated(): Promise<Record<string, unknown>> {
  const groups = await findOutdated(TEXT_MODEL.key, 500);
  let queued = 0;
  for (const g of groups) {
    for (const productId of g.productIds) {
      await enqueue("search.embed-product", { tenantId: g.tenantId, productId }, { singletonKey: productId });
      queued += 1;
    }
  }
  return { tenants: groups.length, queued };
}
