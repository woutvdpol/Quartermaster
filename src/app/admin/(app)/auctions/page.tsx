import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, DateTime, EmptyState, Money, PageHeader, StatusPill, buttonClasses, type Column } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { requireTenantDisplay } from "@/server/tenant-display";
import { AuctionDrawer } from "./_components/AuctionDrawer";
import { auctionsCopy as t } from "./_copy";
import { AUCTION_STATUS_TONE, suggestSchedule } from "./_lib";
import { listAuctionsAdmin } from "./_service";
import type { AuctionListRow } from "./_types";
import { moduleLocked } from "@/components/admin/ModuleGate";

export const metadata: Metadata = { title: "Auctions" };

const BASE = "/admin/auctions";

export default async function AuctionsPage() {
  if (await moduleLocked("auctions")) return null; // ModuleGate in layout.tsx shows the upsell
  const ctx = await requireStaffContext();
  const [rows, tenant] = await Promise.all([listAuctionsAdmin(ctx), requireTenantDisplay(ctx.tenantId)]);
  const tz = tenant.timeZone;

  const columns: Column<AuctionListRow>[] = [
    {
      key: "title",
      header: t.columns.title,
      cell: (r) => (
        <Link href={`${BASE}/${r.id}`} className="font-medium text-ink hover:underline">
          {r.title}
        </Link>
      ),
    },
    { key: "type", header: t.columns.type, hideBelow: "md", cell: (r) => <span className="text-muted">{t.type[r.type]}</span> },
    { key: "status", header: t.columns.status, cell: (r) => <StatusPill tone={AUCTION_STATUS_TONE[r.status]}>{t.statusShort[r.status]}</StatusPill> },
    { key: "opens", header: t.columns.opens, hideBelow: "lg", cell: (r) => <DateTime value={r.opensAt} timeZone={tz} className="text-xs" /> },
    { key: "closes", header: t.columns.closes, cell: (r) => <DateTime value={r.lastCloseAt ?? r.firstCloseAt} timeZone={tz} className="text-xs" /> },
    { key: "lots", header: t.columns.lots, numeric: true, cell: (r) => r.lots },
    { key: "bids", header: t.columns.bids, numeric: true, hideBelow: "sm", cell: (r) => r.bids },
    { key: "hammer", header: t.columns.hammer, numeric: true, hideBelow: "md", cell: (r) => <Money amount={r.hammerTotal} currency={tenant.currency} mono /> },
  ];

  const add = <AuctionDrawer trigger={t.add} triggerVariant="primary" currency={tenant.currency} suggest={suggestSchedule(new Date(), tz)} />;
  return (
    <>
      <PageHeader
        crumb={t.crumb}
        title={t.title}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`${BASE}/bidders`} className={buttonClasses({ variant: "ghost" })}>
              {t.bidders}
            </Link>
            {add}
          </div>
        }
      />
      <div className="p-4 md:px-[22px] md:py-5">
        <DataTable caption={t.title} columns={columns} rows={rows} rowKey={(r) => r.id} empty={<EmptyState title={t.empty.title} body={t.empty.body} action={add} compact />} />
      </div>
    </>
  );
}
