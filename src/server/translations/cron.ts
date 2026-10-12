import "server-only";
import { db } from "@/server/db";
import { tenantsWithModule } from "@/server/modules";
import { kickTranslate, pruneOrphans, syncTenant } from "./sync";

/**
 * Hourly safety net (job `cron.translations.sync`): every tenant that has shop languages enabled and
 * the Translations module (no translator work for the others; their existing rows are kept).
 */
export async function syncAllTenants(): Promise<Record<string, unknown>> {
  const entitled = [...(await tenantsWithModule("translations"))];
  if (!entitled.length) return { tenants: 0, queued: 0, pruned: 0 };
  const rows = await db.setting.findMany({ where: { group: "i18n", tenantId: { in: entitled } }, select: { tenantId: true, data: true } });
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
