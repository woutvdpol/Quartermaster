import type { Metadata } from "next";
import { InlineAlert, PageHeader } from "@/components/admin/ui";
import { queryAuditLog } from "@/server/auditlog";
import { requireStaffContext } from "@/server/context";
import { loadErrorMessage } from "../_system/errors";
import { requireTenantDisplay } from "@/server/tenant-display";
import { loadMoreAuditAction } from "./actions";
import { AuditFilterForm } from "./_components/AuditFilterForm";
import { AuditList } from "./_components/AuditList";
import { PAGE_SIZE, toRows } from "./_data";
import { readFilters, toAuditQuery } from "./_shared";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditLogPage({ searchParams }: PageProps<"/admin/audit-log">) {
  const sp = await searchParams;
  const ctx = await requireStaffContext();
  const tenant = await requireTenantDisplay(ctx.tenantId);
  const filters = readFilters(sp);
  const isSuper = ctx.actor.role === "SUPERADMIN";

  let page: Awaited<ReturnType<typeof queryAuditLog>> | null = null;
  let loadError: string | null = null;
  try {
    page = await queryAuditLog(ctx, { ...toAuditQuery(filters, tenant.timeZone), limit: PAGE_SIZE });
  } catch (err) {
    loadError = loadErrorMessage(err);
  }

  return (
    <>
      <PageHeader crumb="System" title="Audit log" />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <p className="text-[13px] text-muted">
          Every change in {tenant.name}: who did it and when. Times are in {tenant.timeZone}.
          {!isSuper && " Actions by Quartermaster staff are shown without their name."}
        </p>
        <AuditFilterForm basePath="/admin/audit-log" filters={filters} />
        {page ? (
          <AuditList
            key={JSON.stringify(filters)}
            initialRows={toRows(page.items, isSuper)}
            initialCursor={page.nextCursor}
            filters={filters}
            loadMore={loadMoreAuditAction}
            timeZone={tenant.timeZone}
          />
        ) : (
          <InlineAlert tone="crit" title="Could not load the audit log">
            {loadError}
          </InlineAlert>
        )}
      </div>
    </>
  );
}
