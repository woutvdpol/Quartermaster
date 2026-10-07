import "server-only";
import type { AuditEntry } from "@/server/auditlog";
import { entityHref, type AuditRow } from "./_shared";

export const PAGE_SIZE = 50;

function detailsOf(data: unknown): string | null {
  if (data === null || data === undefined) return null;
  if (typeof data === "object" && Object.keys(data as object).length === 0) return null;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return null;
  }
}

export function toRows(items: AuditEntry[], isSuper: boolean): AuditRow[] {
  return items.map((e) => ({
    id: e.id,
    createdAt: e.createdAt.toISOString(),
    tenantId: e.tenantId,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    actor: e.actor?.label ?? "System",
    ip: e.ip,
    summary: e.summary,
    details: detailsOf(e.data),
    href: entityHref(e.entity, e.entityId, e.tenantId, isSuper),
  }));
}
