import "server-only";
import { db } from "@/server/db";
import { getStorage, type StorageDriver } from "@/server/media/storage";
import { DRAFT_TTL_MS, isLeadId } from "./draft";
import { leadFolder } from "./keys";

/*
 * Orphaned lead photos. Visitors upload photos into `{tenantId}/leads/{leadId}/` BEFORE the lead row
 * exists (see ./draft.ts); a draft that is never submitted leaves its folder behind. A daily cron
 * removes folders without a Lead row once they are older than the draft lifetime (24 h) — a draft
 * cannot be submitted after that, so the files can never be referenced. The folder's mtime moves
 * with every upload/delete inside it, so it is the time of the last activity. One hour of grace
 * covers a submit racing the boundary.
 *
 * Needs a listable storage driver (`StorageDriver.list`); other drivers are skipped (S3/R2 would use
 * a bucket lifecycle rule or implement `list`).
 */

export const ORPHAN_LEAD_PHOTO_AGE_MS = DRAFT_TTL_MS + 60 * 60 * 1000;

export type LeadPhotoCleanupResult = { scanned: number; removed: number; skipped?: "unsupported-driver" };

export async function cleanupOrphanLeadPhotos(opts: { now?: Date; storage?: StorageDriver } = {}): Promise<LeadPhotoCleanupResult> {
  const storage = opts.storage ?? getStorage();
  if (!storage.list) return { scanned: 0, removed: 0, skipped: "unsupported-driver" };
  const cutoff = (opts.now ?? new Date()).getTime() - ORPHAN_LEAD_PHOTO_AGE_MS;

  let scanned = 0;
  let removed = 0;
  const tenants = await db.tenant.findMany({ select: { id: true } });
  for (const { id: tenantId } of tenants) {
    const entries = await storage.list(`${tenantId}/leads/`);
    const old = entries.filter((e) => e.kind === "dir" && isLeadId(e.name) && e.lastModified.getTime() < cutoff).map((e) => e.name);
    scanned += entries.length;
    if (old.length === 0) continue;
    const existing = new Set(
      (await db.lead.findMany({ where: { tenantId, id: { in: old } }, select: { id: true } })).map((l) => l.id),
    );
    for (const leadId of old) {
      if (existing.has(leadId)) continue;
      await storage.deletePrefix(leadFolder(tenantId, leadId));
      removed++;
    }
  }
  return { scanned, removed };
}
