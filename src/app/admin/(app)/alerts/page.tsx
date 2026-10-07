import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  ClearFiltersLink,
  ConfirmDialog,
  DataTable,
  DateTime,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHeader,
  Pagination,
  SearchInput,
  StatusPill,
  ViewTabs,
  getParam,
  parsePage,
  type Column,
  type SearchParamsRecord,
  type StatusTone,
} from "@/components/admin/ui";
import { adminAlertStats, adminListSavedSearches, type AdminSearchRow, type SavedSearchStatus } from "@/server/alerts";
import { requireStaffContext } from "@/server/context";
import { requireTenantDisplay } from "@/server/tenant-display";
import { copy } from "./_copy";
import { disableAlertAction, runMatchingAction } from "./actions";

export const metadata: Metadata = { title: copy.title };

const BASE = "/admin/alerts";
const PAGE_SIZE = 50;
type View = SavedSearchStatus | "all";
const VIEWS: readonly View[] = ["active", "pending", "unsubscribed", "all"];
const TONE: Record<SavedSearchStatus, StatusTone> = { active: "ok", pending: "warn", unsubscribed: "mute" };
const n = (v: number) => new Intl.NumberFormat("en-NL").format(v);

export default async function AlertsAdminPage({ searchParams }: PageProps<"/admin/alerts">) {
  const sp = (await searchParams) as SearchParamsRecord;
  const ctx = await requireStaffContext();
  const viewParam = getParam(sp, "view");
  const view: View = VIEWS.includes(viewParam as View) && viewParam ? (viewParam as View) : "active";
  const page = parsePage(sp.page);
  const [stats, list, tenant] = await Promise.all([
    adminAlertStats(ctx),
    adminListSavedSearches(ctx, { status: view, search: getParam(sp, "q") || undefined, page, pageSize: PAGE_SIZE }),
    requireTenantDisplay(ctx.tenantId),
  ]);
  const t = copy.table;

  const columns: Column<AdminSearchRow>[] = [
    {
      key: "name",
      header: t.name,
      cell: (r) => (
        <div className="min-w-0">
          <Link href={r.description.href} target="_blank" rel="noopener" className="font-medium text-ink hover:underline">
            {r.name}
          </Link>
          <div className="truncate text-xs text-muted">
            {[r.description.category?.title, ...r.description.facets.map((f) => `${f.facet}: ${f.name}`), ...r.description.tags.map((x) => `#${x.name}`), r.description.text ? `“${r.description.text}”` : null]
              .filter(Boolean)
              .join(" · ") || "All new arrivals"}
          </div>
        </div>
      ),
    },
    {
      key: "email",
      header: t.email,
      cell: (r) => (
        <span className="font-mono text-xs">
          {r.emailMasked} <span className="text-muted">({r.isCustomer ? t.customer : t.guest})</span>
        </span>
      ),
      hideBelow: "md",
    },
    { key: "frequency", header: t.frequency, cell: (r) => copy.frequency[r.frequency], hideBelow: "sm" },
    { key: "status", header: t.status, cell: (r) => <StatusPill tone={TONE[r.status]}>{copy.status[r.status]}</StatusPill> },
    { key: "matches", header: t.matches, numeric: true, cell: (r) => n(r.deliveries) },
    { key: "created", header: t.created, cell: (r) => <DateTime value={r.createdAt} format="date" timeZone={tenant.timeZone} />, hideBelow: "lg" },
    {
      key: "last",
      header: t.lastSent,
      cell: (r) => (r.lastNotifiedAt ? <DateTime value={r.lastNotifiedAt} format="relative" timeZone={tenant.timeZone} /> : "—"),
      hideBelow: "lg",
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (r) =>
        r.status === "unsubscribed" ? null : (
          <ConfirmDialog
            trigger={copy.disable}
            triggerSize="sm"
            tone="danger"
            title={copy.disableTitle}
            description={copy.disableBody}
            confirmLabel={copy.disableConfirm}
            action={disableAlertAction}
            fields={{ id: r.id }}
          />
        ),
    },
  ];

  return (
    <>
      <PageHeader
        crumb={copy.crumb}
        title={copy.title}
        actions={
          <ConfirmDialog
            trigger={copy.runNow}
            tone="primary"
            title={copy.runTitle}
            description={copy.runBody}
            confirmLabel={copy.runConfirm}
            action={runMatchingAction}
          />
        }
      />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <section aria-label={copy.stats.label} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label={copy.stats.active}
            value={n(stats.activeSearches)}
            note={copy.stats.activeNote(stats.byFrequency.INSTANT, stats.byFrequency.DAILY, stats.byFrequency.WEEKLY)}
          />
          <KpiCard label={copy.stats.pending} value={n(stats.pendingSearches)} note={copy.stats.pendingNote} />
          <KpiCard label={copy.stats.deliveries} value={n(stats.deliveries30d.savedSearch)} note={copy.stats.deliveriesNote} />
          <KpiCard
            label={copy.stats.wishlist}
            value={n(stats.deliveries30d.backAvailable + stats.deliveries30d.priceDrop)}
            note={copy.stats.wishlistNote(stats.deliveries30d.backAvailable, stats.deliveries30d.priceDrop)}
          />
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <TopList title={copy.topCategories} items={stats.topCategories.map((c) => ({ id: c.id, label: c.title, count: c.count }))} />
          <TopList title={copy.topFacets} items={stats.topFacetValues.map((v) => ({ id: v.id, label: `${v.facet}: ${v.name}`, count: v.count }))} />
        </div>

        <DataTable
          caption={t.caption}
          columns={columns}
          rows={list.items}
          rowKey={(r) => r.id}
          empty={<EmptyState compact title={t.empty} body={t.emptyBody} />}
          toolbar={
            <>
              <ViewTabs
                label={copy.tabs.label}
                basePath={BASE}
                searchParams={sp}
                active={view === "active" ? null : view}
                views={[
                  { value: null, label: copy.tabs.active, count: stats.activeSearches },
                  { value: "pending", label: copy.tabs.pending, count: stats.pendingSearches },
                  { value: "unsubscribed", label: copy.tabs.unsubscribed, count: stats.unsubscribedSearches },
                  { value: "all", label: copy.tabs.all },
                ]}
              />
              <FilterBar end={<ClearFiltersLink params={["q"]} basePath={BASE} searchParams={sp} />}>
                <SearchInput placeholder={copy.search} />
              </FilterBar>
            </>
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={list.total} basePath={BASE} searchParams={sp} />}
        />
      </div>
    </>
  );
}

function TopList({ title, items }: { title: string; items: { id: string; label: string; count: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <Card title={title}>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{copy.noTop}</p>
      ) : (
        <ol className="grid gap-2">
          {items.map((i) => (
            <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[13.5px]">
              <span className="truncate">{i.label}</span>
              <span className="font-mono text-xs tabular-nums text-muted">{n(i.count)}</span>
              <span aria-hidden="true" className="col-span-2 h-1 overflow-hidden rounded-full bg-panel-2">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round((i.count / max) * 100)}%` }} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
