import "server-only";
import { requestClientIp } from "@/server/request-meta";
import { db } from "@/server/db";
import { invalidateShopForAction } from "@/server/storefront/cache";
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
}
