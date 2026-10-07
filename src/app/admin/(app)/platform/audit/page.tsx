import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_TIME_ZONE, InlineAlert, PageHeader, Select, getParam } from "@/components/admin/ui";
import { queryPlatformAuditLog } from "@/server/auditlog";
import { listTenants, requirePlatformContext } from "@/server/platform";
import { loadErrorMessage } from "../../_system/errors";
import { AuditFilterForm } from "../../audit-log/_components/AuditFilterForm";
import { AuditList } from "../../audit-log/_components/AuditList";
import { PAGE_SIZE, toRows } from "../../audit-log/_data";
import { readFilters, toAuditQuery } from "../../audit-log/_shared";
import { loadMorePlatformAuditAction, type PlatformAuditScope } from "../actions";

export const metadata: Metadata = { title: "Platform audit log" };

export default async function PlatformAuditPage({ searchParams }: PageProps<"/admin/platform/audit">) {
  const sp = await searchParams;
  const ctx = await requirePlatformContext();
  const filters = readFilters(sp);
  const scope: PlatformAuditScope = { scope: getParam(sp, "scope") === "all" ? "all" : "platform" };
  const tenants = await listTenants(ctx);
  const tenantNames = Object.fromEntries(tenants.map((t) => [t.id, t.name]));

  let page: Awaited<ReturnType<typeof queryPlatformAuditLog>> | null = null;
  let loadError: string | null = null;
  try {
    page = await queryPlatformAuditLog(ctx, { ...toAuditQuery(filters, DEFAULT_TIME_ZONE), ...scope, limit: PAGE_SIZE });
  } catch (err) {
    loadError = loadErrorMessage(err);
  }

  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link href="/admin/platform" className="hover:text-ink hover:underline">
              Platform
            </Link>{" "}
            · Audit
          </>
        }
        title="Platform audit log"
      />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <p className="text-[13px] text-muted">
          Platform-level events: superadmin sign-ins, failed sign-ins on the platform host and changes to platform accounts. Choose “All shops” to
          include every shop&apos;s log. Times in {DEFAULT_TIME_ZONE}.
        </p>
        <AuditFilterForm
          basePath="/admin/platform/audit"
          filters={filters}
          extra={
            <div className="w-40">
              <Select
                label="Scope"
                name="scope"
                defaultValue={scope.scope}
                options={[
                  { value: "platform", label: "Platform only" },
                  { value: "all", label: "All shops" },
                ]}
              />
            </div>
          }
        />
        {page ? (
          <AuditList
            key={JSON.stringify([filters, scope])}
            initialRows={toRows(page.items, true)}
            initialCursor={page.nextCursor}
            filters={filters}
            loadMore={loadMorePlatformAuditAction.bind(null, scope)}
            timeZone={DEFAULT_TIME_ZONE}
            showTenant={scope.scope === "all"}
            tenantNames={tenantNames}
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
