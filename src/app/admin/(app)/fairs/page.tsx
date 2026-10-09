import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, DateTime, EmptyState, Money, PageHeader, StatusPill, type Column } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { listFairs, type FairRow } from "@/server/fairs";
import { requireTenantDisplay } from "@/server/tenant-display";
import { FairDrawer } from "./_components/FairDrawer";
import { fairsCopy as t } from "./_copy";
import { FAIR_STATUS_TONE as STATUS_TONE } from "./_lib";

export const metadata: Metadata = { title: "Fairs" };

const BASE = "/admin/fairs";

export default async function FairsPage() {
  const ctx = await requireStaffContext();
  const [rows, tenant] = await Promise.all([listFairs(ctx), requireTenantDisplay(ctx.tenantId)]);

  const columns: Column<FairRow>[] = [
    {
      key: "name",
      header: t.columns.name,
      cell: (r) => (
        <Link href={`${BASE}/${r.id}`} className="font-medium text-ink hover:underline">
          {r.name}
        </Link>
      ),
    },
    {
      key: "dates",
      header: t.columns.dates,
      cell: (r) => (
        <span className="text-xs">
          <DateTime value={r.startsOn} format="date" timeZone="UTC" />
          {r.endsOn && r.endsOn.getTime() !== r.startsOn.getTime() ? (
            <>
              {" – "}
              <DateTime value={r.endsOn} format="date" timeZone="UTC" />
            </>
          ) : null}
        </span>
      ),
    },
    { key: "status", header: t.columns.status, cell: (r) => <StatusPill tone={STATUS_TONE[r.status]}>{t.status[r.status]}</StatusPill> },
    { key: "items", header: t.columns.items, numeric: true, cell: (r) => r.itemCount },
    { key: "sold", header: t.columns.sold, numeric: true, cell: (r) => r.soldCount },
    { key: "revenue", header: t.columns.revenue, numeric: true, hideBelow: "md", cell: (r) => <Money amount={r.revenue} currency={tenant.currency} mono /> },
  ];

  const add = <FairDrawer trigger={t.add} triggerVariant="primary" />;
  return (
    <>
      <PageHeader crumb={t.crumb} title={t.title} actions={add} />
      <div className="p-4 md:px-[22px] md:py-5">
        <DataTable caption={t.title} columns={columns} rows={rows} rowKey={(r) => r.id} empty={<EmptyState title={t.empty.title} body={t.empty.body} action={add} compact />} />
      </div>
    </>
  );
}
