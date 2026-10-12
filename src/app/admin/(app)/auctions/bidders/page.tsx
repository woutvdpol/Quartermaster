import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmDialog, DataTable, DateTime, EmptyState, PageHeader, hintClass, type Column } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { requireTenantDisplay } from "@/server/tenant-display";
import { auctionsCopy as t } from "../_copy";
import { listBlockedBidders } from "../_service";
import type { BlockedBidderRow } from "../_types";
import { unblockBidderAction } from "../actions";

export const metadata: Metadata = { title: "Blocked bidders" };

const b = t.blocked;

export default async function BlockedBiddersPage() {
  const ctx = await requireStaffContext();
  const [rows, tenant] = await Promise.all([listBlockedBidders(ctx), requireTenantDisplay(ctx.tenantId)]);

  const columns: Column<BlockedBidderRow>[] = [
    {
      key: "customer",
      header: b.cols.customer,
      cell: (r) => (
        <Link href={`/admin/customers/${r.customerId}`} className="font-medium text-ink hover:underline">
          {r.name}
        </Link>
      ),
    },
    { key: "email", header: b.cols.email, hideBelow: "md", cell: (r) => <span className="text-muted">{r.email}</span> },
    { key: "reason", header: b.cols.reason, cell: (r) => r.reason ?? <span className="text-muted">—</span> },
    { key: "since", header: b.cols.since, hideBelow: "sm", cell: (r) => <DateTime value={r.createdAt} format="date" timeZone={tenant.timeZone} /> },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (r) => (
        <ConfirmDialog
          trigger={b.unblock}
          triggerVariant="ghost"
          triggerSize="sm"
          tone="primary"
          title={b.unblockTitle}
          description={`${r.name} · ${b.unblockBody}`}
          confirmLabel={b.unblock}
          action={unblockBidderAction}
          fields={{ customerId: r.customerId }}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        crumb={
          <Link href="/admin/auctions" className="hover:underline">
            {t.title}
          </Link>
        }
        title={b.title}
      />
      <div className="grid gap-3 p-4 md:px-[22px] md:py-5">
        <p className={hintClass}>{b.intro}</p>
        <DataTable caption={b.title} columns={columns} rows={rows} rowKey={(r) => r.customerId} empty={<EmptyState title={b.empty} compact />} />
      </div>
    </>
  );
}
