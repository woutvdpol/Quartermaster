import "server-only";
import { requestClientIp } from "@/server/request-meta";
import { db } from "@/server/db";
import { invalidateShopForAction } from "@/server/storefront/cache";
import { onAudited as updateSearchIndex } from "@/server/search/hooks";
import { onAudited as updateTranslations } from "@/server/translations/hooks";
import type { Prisma } from "@/generated/prisma/client";

type AuditEntry = {
  action: string;
  tenantId?: string | null;
  actorId?: string | null;
  entity?: string;
  entityId?: string | number;
  data?: Prisma.InputJsonValue;
};

export async function audit(entry: AuditEntry) {
  // Null outside a request (seed, worker, scripts) and when no trusted proxy is configured.
  const ip = await requestClientIp();
  await db.auditLog.create({
    data: {
      action: entry.action,
      tenantId: entry.tenantId ?? null,
      actorId: entry.actorId ?? null,
      entity: entry.entity,
      entityId: entry.entityId?.toString(),
      data: entry.data,
      ip,
    },
  });
  invalidateShopForAction(entry.tenantId, entry.action);
  // Product/taxonomy changes → (debounced) search index jobs (src/server/search/hooks.ts). Never throws.
  await updateSearchIndex(entry);
  // Changed source texts → (debounced) translation sync for the shop languages (src/server/translations/hooks.ts). Never throws.
  await updateTranslations(entry);
}
