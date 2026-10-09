import "server-only";
import { db } from "@/server/db";
import { kickTranslate, pruneOrphans, syncTenant } from "./sync";

/** Hourly safety net (job `cron.translations.sync`): every tenant that has shop languages enabled. */
export async function syncAllTenants(): Promise<Record<string, unknown>> {
  const rows = await db.setting.findMany({ where: { group: "i18n" }, select: { tenantId: true, data: true } });
  const tenants = rows.filter((r) => Array.isArray((r.data as { locales?: unknown } | null)?.locales) && ((r.data as { locales: unknown[] }).locales.length > 0)).map((r) => r.tenantId);
  let queued = 0;
  let pruned = 0;
  for (const tenantId of tenants) {
    const counts = await syncTenant(tenantId, "recent");
    queued += counts.created + counts.requeued;
    pruned += await pruneOrphans(tenantId);
    if (await db.translation.count({ where: { tenantId, status: "QUEUED" }, take: 1 })) await kickTranslate(tenantId);
  }
  return { tenants: tenants.length, queued, pruned };
}
