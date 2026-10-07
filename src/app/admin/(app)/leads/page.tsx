import type { Metadata } from "next";
import Link from "next/link";
import {
  ClearFiltersLink,
  DataTable,
  DateTime,
  EmptyState,
  FilterBar,
  PageHeader,
  Pagination,
  SearchInput,
  StatusPill,
  Thumb,
  ViewTabs,
  getParam,
  hrefWith,
  parsePage,
  type Column,
  type StatusTone,
} from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { getLead, listLeads, LEAD_STATUSES, LEAD_STATUS_LABEL, type LeadListItem, type LeadStatusValue } from "@/server/leads";
import { requireTenantDisplay } from "@/server/tenant-display";
import { copy } from "./_copy";
import { LeadDrawer, type LeadDrawerData } from "./_components/LeadDrawer";

export const metadata: Metadata = { title: copy.title };

const PAGE_SIZE = 25;
const BASE = "/admin/leads";

const VIEW_TO_STATUS: Record<string, LeadStatusValue> = Object.fromEntries(LEAD_STATUSES.map((s) => [s.toLowerCase(), s]));

const STATUS_TONE: Record<LeadStatusValue, StatusTone> = { NEW: "info", CONTACTED: "warn", BOUGHT: "ok", DECLINED: "mute" };

function excerpt(text: string, max = 110): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export default async function LeadsPage({ searchParams }: PageProps<"/admin/leads">) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const view = getParam(sp, "view");
  const status = view ? (VIEW_TO_STATUS[view] ?? null) : null;
  const q = getParam(sp, "q")?.slice(0, 200) || null;
  const leadId = getParam(sp, "lead")?.slice(0, 64);

  const ctx = await requireStaffContext();
  const [result, fmt, lead] = await Promise.all([
    listLeads(ctx, { status, q, page, pageSize: PAGE_SIZE }),
    requireTenantDisplay(ctx.tenantId),
    leadId ? getLead(ctx, leadId) : Promise.resolve(null),
  ]);
  const now = new Date();

  const columns: Column<LeadListItem>[] = [
    {
      key: "received",
      header: copy.cols.received,
      width: "130px",
      cell: (r) => <DateTime value={r.createdAt} format="relative" now={now} timeZone={fmt.timeZone} />,
    },
    {
      key: "seller",
      header: copy.cols.seller,
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-3">
          <Thumb src={r.thumbUrl} alt="" size="sm" />
          <div className="min-w-0">
            <Link href={hrefWith(BASE, sp, { lead: r.id })} scroll={false} className="font-medium hover:underline">
              {r.name}
            </Link>
            <div className="truncate text-xs text-muted">{r.email}</div>
          </div>
        </div>
      ),
    },
    { key: "items", header: copy.cols.items, hideBelow: "md", cell: (r) => <span className="text-[13px] text-muted">{excerpt(r.itemsDescription)}</span> },
    { key: "photos", header: copy.cols.photos, numeric: true, hideBelow: "sm", cell: (r) => r.photoCount },
    { key: "status", header: copy.cols.status, cell: (r) => <StatusPill tone={STATUS_TONE[r.status]}>{LEAD_STATUS_LABEL[r.status]}</StatusPill> },
  ];

  const drawerData: LeadDrawerData | null = lead
    ? {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        itemsDescription: lead.itemsDescription,
        message: lead.message,
        status: lead.status,
        note: lead.note,
        createdAt: lead.createdAt.toISOString(),
        updatedAt: lead.updatedAt.toISOString(),
        handledBy: lead.handledBy ? lead.handledBy.name || lead.handledBy.email : null,
        photos: lead.photos.map((p) => ({ url: p.url, thumbUrl: p.thumbUrl })),
      }
    : null;

  const filtered = Boolean(q || status);

  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <DataTable
          caption={copy.caption}
          columns={columns}
          rows={result.items}
          rowKey={(r) => r.id}
          rowClassName={(r) => (r.id === leadId ? "bg-panel-2" : undefined)}
          toolbar={
            <>
              <ViewTabs
                basePath={BASE}
                searchParams={sp}
                active={view && VIEW_TO_STATUS[view] ? view : null}
                views={[
                  { value: null, label: copy.views.all, count: result.counts.ALL },
                  ...LEAD_STATUSES.map((s) => ({ value: s.toLowerCase(), label: copy.views[s], count: result.counts[s] })),
                ]}
              />
              <FilterBar end={<ClearFiltersLink params={["q"]} basePath={BASE} searchParams={sp} />}>
                <SearchInput placeholder={copy.search} label={copy.search} />
              </FilterBar>
            </>
          }
          empty={
            filtered ? (
              <EmptyState compact title={copy.emptyFiltered} body={copy.emptyFilteredBody} />
            ) : (
              <EmptyState title={copy.empty} body={copy.emptyBody} />
            )
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={result.total} basePath={BASE} searchParams={sp} />}
        />
      </div>
      {drawerData ? <LeadDrawer key={drawerData.id} lead={drawerData} closeHref={hrefWith(BASE, sp, { lead: null })} timeZone={fmt.timeZone} /> : null}
    </>
  );
}
