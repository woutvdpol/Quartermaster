"use server";

import { actionOk, type ActionResult } from "@/components/admin/ui";
import { queryAuditLog } from "@/server/auditlog";
import { requireStaffContext } from "@/server/context";
import { failFrom } from "../_system/errors";
import { requireTenantDisplay } from "@/server/tenant-display";
import { PAGE_SIZE, toRows } from "./_data";
import { toAuditQuery, type AuditFilters, type AuditRow } from "./_shared";

/** Next page of the tenant audit log (read-only; keyset cursor). */
export async function loadMoreAuditAction(
  filters: AuditFilters,
  cursor: string,
): Promise<ActionResult<string, { rows: AuditRow[]; nextCursor: string | null }>> {
  try {
    const ctx = await requireStaffContext();
    const tenant = await requireTenantDisplay(ctx.tenantId);
    const page = await queryAuditLog(ctx, { ...toAuditQuery(filters, tenant.timeZone), cursor, limit: PAGE_SIZE });
    return actionOk(undefined, { rows: toRows(page.items, ctx.actor.role === "SUPERADMIN"), nextCursor: page.nextCursor });
  } catch (err) {
    return failFrom(err);
  }
}
