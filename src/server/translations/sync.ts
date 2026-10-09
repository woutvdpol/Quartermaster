import "server-only";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { enqueue } from "@/server/jobs/queue";
import { TRANSLATABLE_FIELDS, TRANSLATION_ENTITIES, type TranslationEntityName, type TranslationLocale } from "./fields";
import { loadSources, ENTITY_TABLES, type SourceFilter, type SourceRow } from "./sources";
import { normalizeSource, planSync, type RowState } from "./state";

/*
 * Keeps Translation rows in step with the English source texts (the "queue" half of docs/i18n.md
 * § Vertalen): per source field × enabled language one row; state rules in ./state.ts.
 * Runs in the worker (job `translations.sync`), never inside a product save.
 */

export type SyncCounts = { created: number; requeued: number; staleChanged: number; deleted: number };

const empty = (): SyncCounts => ({ created: 0, requeued: 0, staleChanged: 0, deleted: 0 });

export async function enabledLocales(tenantId: string): Promise<TranslationLocale[]> {
  return (await getSettings(tenantId, "i18n")).locales;
}

/** Applies planSync() to a batch of source rows. */
export async function syncRows(tenantId: string, entity: TranslationEntityName, sources: SourceRow[], locales: readonly TranslationLocale[]): Promise<SyncCounts> {
  const counts = empty();
  if (!sources.length || !locales.length) return counts;
  const existing = await db.translation.findMany({
    where: { tenantId, entity, entityId: { in: sources.map((s) => s.entityId) }, locale: { in: [...locales] } },
    select: { id: true, entityId: true, field: true, locale: true, status: true, sourceHash: true, stale: true },
  });
  const byKey = new Map(existing.map((r) => [`${r.entityId}|${r.field}|${r.locale}`, r]));

  const creates: { tenantId: string; entity: TranslationEntityName; entityId: string; field: string; locale: string; sourceHash: string }[] = [];
  const updates: Promise<unknown>[] = [];
  const deletes: string[] = [];

  for (const src of sources) {
    for (const field of TRANSLATABLE_FIELDS[entity]) {
      const text = normalizeSource(src.fields[field]);
      for (const locale of locales) {
        const row = byKey.get(`${src.entityId}|${field}|${locale}`) ?? null;
        const plan = planSync(row as RowState | null, text);
        switch (plan.kind) {
          case "create":
            creates.push({ tenantId, entity, entityId: src.entityId, field, locale, sourceHash: plan.sourceHash });
            counts.created++;
            break;
          case "requeue":
            // Conditional: a concurrent approve wins (the row is then no longer QUEUED/MACHINE).
            updates.push(
              db.translation.updateMany({ where: { id: row!.id, status: { in: ["QUEUED", "MACHINE"] } }, data: { status: "QUEUED", sourceHash: plan.sourceHash, stale: false } }),
            );
            counts.requeued++;
            break;
          case "stale":
            updates.push(db.translation.updateMany({ where: { id: row!.id, status: "APPROVED" }, data: { stale: plan.stale } }));
            counts.staleChanged++;
            break;
          case "delete":
            deletes.push(row!.id);
            counts.deleted++;
            break;
        }
      }
    }
  }
  if (creates.length) await db.translation.createMany({ data: creates, skipDuplicates: true });
  await Promise.all(updates);
  if (deletes.length) await db.translation.deleteMany({ where: { tenantId, id: { in: deletes } } });
  return counts;
}

function add(a: SyncCounts, b: SyncCounts) {
  a.created += b.created;
  a.requeued += b.requeued;
  a.staleChanged += b.staleChanged;
  a.deleted += b.deleted;
}

/** Syncs one entity (or a few ids) and starts the translate job when something was queued. */
export async function syncEntity(tenantId: string, entity: TranslationEntityName, ids: string[]): Promise<SyncCounts> {
  const locales = await enabledLocales(tenantId);
  if (!locales.length) return empty();
  const sources = await loadSources(tenantId, entity, { ids });
  const counts = await syncRows(tenantId, entity, sources, locales);
  // Deleted entities: their rows go too.
  const found = new Set(sources.map((s) => s.entityId));
  const gone = ids.filter((id) => !found.has(id));
  if (gone.length) counts.deleted += (await db.translation.deleteMany({ where: { tenantId, entity, entityId: { in: gone } } })).count;
  if (counts.created || counts.requeued) await kickTranslate(tenantId);
  return counts;
}

export type SyncScope =
  /** Everything translatable, existing stock = unsold products (DRAFT/ACTIVE/RESERVED). */
  | "stock"
  /** Everything, also sold/archived products (the public sold archive). */
  | "all"
  /** Only rows changed recently (cron safety net). */
  | "recent";

/** Syncs a whole tenant (bulk "Translate existing stock", imports, the cron). Paged, any size. */
export async function syncTenant(tenantId: string, scope: SyncScope, opts: { since?: Date; signal?: AbortSignal } = {}): Promise<SyncCounts> {
  const counts = empty();
  const locales = await enabledLocales(tenantId);
  if (!locales.length) return counts;
  for (const entity of TRANSLATION_ENTITIES) {
    let after: string | undefined;
    for (;;) {
      if (opts.signal?.aborted) throw new Error("aborted");
      const filter: SourceFilter = { after, take: 500 };
      if (scope === "recent") filter.since = opts.since ?? new Date(Date.now() - 2 * 60 * 60 * 1000);
      if (entity === "PRODUCT" && scope === "stock") filter.productStatuses = ["DRAFT", "ACTIVE", "RESERVED"];
      if (entity === "PRODUCT" && scope === "all") filter.productStatuses = ["DRAFT", "ACTIVE", "RESERVED", "SOLD", "ARCHIVED"];
      const sources = await loadSources(tenantId, entity, filter);
      if (!sources.length) break;
      add(counts, await syncRows(tenantId, entity, sources, locales));
      after = sources[sources.length - 1].entityId;
      if (sources.length < 500) break;
    }
  }
  if (counts.created || counts.requeued) await kickTranslate(tenantId);
  return counts;
}

/** Removes rows whose entity no longer exists (deleted facets cascade their values, merges …). */
export async function pruneOrphans(tenantId: string): Promise<number> {
  let removed = 0;
  for (const entity of TRANSLATION_ENTITIES) {
    const table = ENTITY_TABLES[entity];
    removed += await db.$executeRawUnsafe(
      `DELETE FROM "translations" t WHERE t."tenantId" = $1 AND t."entity" = $2::"TranslationEntity" AND NOT EXISTS (SELECT 1 FROM "${table}" e WHERE e."id" = t."entityId")`,
      tenantId,
      entity,
    );
  }
  return removed;
}

/** Starts (or nudges) the per-tenant translate job; collapses with one already queued. */
export async function kickTranslate(tenantId: string, startAfter = 2): Promise<void> {
  try {
    await enqueue("translations.translate", { tenantId }, { singletonKey: tenantId, startAfter });
  } catch (err) {
    console.error(`[translations] could not queue the translate job for ${tenantId}`, err);
  }
}
