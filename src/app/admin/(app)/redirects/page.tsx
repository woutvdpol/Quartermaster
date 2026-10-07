import type { Metadata } from "next";
import {
  ConfirmDialog,
  DataTable,
  DateTime,
  EmptyState,
  FilterBar,
  PageHeader,
  Pagination,
  SearchInput,
  StatusPill,
  ViewTabs,
  buttonClasses,
  getParam,
  parsePage,
  parseSort,
  type Column,
} from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { REDIRECT_SORTS, listRedirects, type RedirectRow } from "@/server/redirects";
import { requireTenantDisplay } from "@/server/tenant-display";
import { ImportDrawer } from "./_components/ImportDrawer";
import { RedirectDrawer } from "./_components/RedirectDrawer";
import { deleteRedirectAction } from "./actions";
import { redirectsCopy as t } from "./_copy";

export const metadata: Metadata = { title: "Redirects" };

const BASE = "/admin/redirects";
const PAGE_SIZE = 50;
const VIEWS = ["all", "MANUAL", "LEGACY"] as const;
type View = (typeof VIEWS)[number];

export default async function RedirectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaffContext();
  const v = getParam(sp, "source");
  const view: View = (VIEWS as readonly string[]).includes(v ?? "") ? (v as View) : "all";
  const page = parsePage(sp.page);
  const sortParam = getParam(sp, "sort") ?? "-createdAt";
  const sort = parseSort(sortParam, REDIRECT_SORTS) ?? { key: "createdAt" as const, dir: "desc" as const };
  const q = getParam(sp, "q");
  const [list, tenant] = await Promise.all([
    listRedirects(ctx, { source: view, q, sort: sort.key, dir: sort.dir, page, pageSize: PAGE_SIZE }),
    requireTenantDisplay(ctx.tenantId),
  ]);

  const columns: Column<RedirectRow>[] = [
    {
      key: "from",
      header: t.columns.from,
      sortKey: "fromPath",
      cell: (r) => <span className="font-mono text-xs break-all text-ink">{r.fromPath}</span>,
    },
    {
      key: "to",
      header: t.columns.to,
      cell: (r) => <span className="font-mono text-xs break-all">{r.toPath}</span>,
    },
    {
      key: "status",
      header: t.columns.status,
      hideBelow: "md",
      cell: (r) => <StatusPill tone={r.statusCode === 302 ? "warn" : "info"}>{r.statusCode === 302 ? t.status[302] : t.status[301]}</StatusPill>,
    },
    {
      key: "source",
      header: t.columns.source,
      hideBelow: "lg",
      cell: (r) => <StatusPill tone={r.source === "LEGACY" ? "mute" : "ok"}>{t.source[r.source]}</StatusPill>,
    },
    { key: "hits", header: t.columns.hits, sortKey: "hits", numeric: true, cell: (r) => <span className="font-mono">{r.hits}</span> },
    {
      key: "lastHit",
      header: t.columns.lastHit,
      sortKey: "lastHitAt",
      hideBelow: "md",
      cell: (r) => (r.lastHitAt ? <DateTime value={r.lastHitAt} format="relative" timeZone={tenant.timeZone} /> : <span className="text-muted">{t.never}</span>),
    },
    {
      key: "created",
      header: t.columns.created,
      sortKey: "createdAt",
      hideBelow: "lg",
      cell: (r) => <DateTime value={r.createdAt} format="date" timeZone={tenant.timeZone} />,
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <a
            href={r.fromPath}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses({ variant: "ghost", size: "sm" })}
            aria-label={t.testLabel(r.fromPath)}
            title={t.testLabel(r.fromPath)}
          >
            {t.test}
          </a>
          {r.source === "MANUAL" ? (
            <RedirectDrawer trigger={t.edit} triggerVariant="ghost" triggerSize="sm" redirect={{ id: r.id, fromPath: r.fromPath, toPath: r.toPath, statusCode: r.statusCode }} />
          ) : null}
          <ConfirmDialog
            trigger={t.deleteLabel}
            triggerVariant="ghost"
            triggerSize="sm"
            title={t.deleteTitle}
            description={r.source === "LEGACY" ? `${t.deleteBody(r.fromPath)} ${t.legacyHint}` : t.deleteBody(r.fromPath)}
            confirmLabel={t.deleteLabel}
            action={deleteRedirectAction}
            fields={{ id: r.id }}
          />
        </div>
      ),
    },
  ];

  const add = <RedirectDrawer trigger={t.add} triggerVariant="primary" />;
  const exportHref = `${BASE}/export${view === "all" ? "" : `?source=${view}`}`;
  const actions = (
    <>
      <a href={exportHref} className={buttonClasses({ variant: "ghost" })} download>
        {t.export}
      </a>
      <ImportDrawer />
      {add}
    </>
  );
  const filtered = Boolean(q) || view !== "all";

  return (
    <>
      <PageHeader crumb={t.crumb} title={t.title} actions={actions} />
      <div className="grid gap-3 p-4 md:px-[22px] md:py-5">
        <p className="max-w-3xl text-sm text-muted">{t.intro}</p>
        <DataTable
          caption={t.title}
          columns={columns}
          rows={list.rows}
          rowKey={(r) => r.id}
          sorting={{ sort: sortParam, basePath: BASE, searchParams: sp }}
          empty={
            filtered && list.counts.all > 0 ? (
              <EmptyState title={t.emptyFiltered.title} body={t.emptyFiltered.body} compact />
            ) : (
              <EmptyState title={t.empty.title} body={t.empty.body} action={add} compact />
            )
          }
          toolbar={
            <>
              <ViewTabs
                basePath={BASE}
                searchParams={sp}
                param="source"
                active={view === "all" ? null : view}
                views={VIEWS.map((x) => ({ value: x === "all" ? null : x, label: t.views[x], count: list.counts[x] }))}
              />
              <FilterBar>
                <SearchInput placeholder={t.search} />
              </FilterBar>
            </>
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={list.total} basePath={BASE} searchParams={sp} />}
        />
      </div>
    </>
  );
}
