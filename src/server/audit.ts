import "server-only";
import { headers } from "next/headers";
import { db } from "@/server/db";
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
  // Outside a request (seed, worker, scripts) Next 16's headers() throws synchronously.
  const h = await Promise.resolve()
    .then(() => headers())
    .catch(() => null);
  const ip = h?.get("x-forwarded-for")?.split(",")[0]?.trim() || h?.get("x-real-ip") || null;
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
}
