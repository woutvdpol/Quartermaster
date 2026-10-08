import type { Metadata } from "next";
import Link from "next/link";
import {
  DataTable,
  DateTime,
  EmptyState,
  FilterBar,
  PageHeader,
  SearchInput,
  StatusPill,
  ViewTabs,
  buttonClasses,
  getParam,
  type Column,
} from "@/components/admin/ui";
import { listTenants, requirePlatformContext, type TenantListItem } from "@/server/platform";
import { countApplications } from "@/server/onboarding";
import { CreateTenantDrawer } from "./_components/CreateTenantDrawer";
import { STATUS_LABEL, STATUS_TONE, timeZoneOptions, type TenantStatusValue } from "./_shared";

export const metadata: Metadata = { title: "Platform · Shops" };

const STATUSES: TenantStatusValue[] = ["ACTIVE", "SUSPENDED", "ARCHIVED"];

export default async function PlatformPage({ searchParams }: PageProps<"/admin/platform">) {
  const sp = await searchParams;
  const ctx = await requirePlatformContext();
  const statusParam = getParam(sp, "status");
  const status = STATUSES.find((s) => s === statusParam?.toUpperCase());
  const q = getParam(sp, "q")?.slice(0, 120);

  const [tenants, all, applicationCounts] = await Promise.all([
    listTenants(ctx, { status, search: q || undefined }),
    listTenants(ctx),
    countApplications(ctx),
  ]);
  const pendingApplications = applicationCounts.PENDING;
  const count = (s?: TenantStatusValue) => (s ? all.filter((t) => t.status === s).length : all.length);
  const now = new Date();
  const basePath = "/admin/platform";

  const columns: Column<TenantListItem>[] = [
    {
      key: "shop",
      header: "Shop",
      cell: (t) => (
        <span className="grid">
          <Link href={`/admin/platform/${t.id}`} className="font-medium text-ink underline-offset-2 hover:text-accent hover:underline">
            {t.name}
          </Link>
          <span className="font-mono text-xs text-muted">{t.primaryHost ?? t.slug}</span>
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (t) => <StatusPill tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</StatusPill> },
    {
      key: "products",
      header: "Products",
      numeric: true,
      hideBelow: "sm",
      cell: (t) => (
        <span title={`${t.activeProductCount} active of ${t.productCount}`}>
          {t.activeProductCount}
          <span className="text-muted"> / {t.productCount}</span>
        </span>
      ),
    },
    { key: "orders", header: "Orders 30d", numeric: true, hideBelow: "md", cell: (t) => t.orders30d },
    { key: "owners", header: "Owners", numeric: true, hideBelow: "lg", cell: (t) => t.ownerCount },
    { key: "currency", header: "Currency", hideBelow: "lg", cell: (t) => <span className="font-mono">{t.currency}</span> },
    {
      key: "activity",
      header: "Last activity",
      hideBelow: "md",
      cell: (t) => (t.lastActivityAt ? <DateTime value={t.lastActivityAt} format="relative" now={now} /> : <span className="text-muted">None</span>),
    },
  ];

  return (
    <>
      <PageHeader
        crumb="Platform"
        title="Shops"
        actions={
          <>
            <Link href="/admin/platform/applications" className={buttonClasses()}>
              Applications{pendingApplications ? ` (${pendingApplications} pending)` : ""}
            </Link>
            <Link href="/admin/platform/audit" className={buttonClasses()}>
              Platform audit log
            </Link>
            <CreateTenantDrawer timeZones={timeZoneOptions()} />
          </>
        }
      />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <DataTable
          caption="Shops on this platform"
          columns={columns}
          rows={tenants}
          rowKey={(t) => t.id}
          rowLabel={(t) => t.name}
          toolbar={
            <>
              <ViewTabs
                basePath={basePath}
                searchParams={sp}
                param="status"
                active={status?.toLowerCase() ?? null}
                views={[
                  { value: null, label: "All", count: count() },
                  ...STATUSES.map((s) => ({ value: s.toLowerCase(), label: STATUS_LABEL[s], count: count(s) })),
                ]}
              />
              <FilterBar>
                <SearchInput placeholder="Search name, slug or domain…" label="Search shops" />
              </FilterBar>
            </>
          }
          empty={
            all.length === 0 ? (
              <EmptyState compact title="No shops yet" body="Create the first shop with “New shop”." />
            ) : (
              <EmptyState compact title="No shops match" body="Try another search or status." />
            )
          }
        />
      </div>
    </>
  );
}
