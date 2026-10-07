import type { Metadata } from "next";
import Link from "next/link";
import {
  ClearFiltersLink,
  DataTable,
  DateTime,
  EmptyState,
  FilterBar,
  InlineAlert,
  PageHeader,
  SearchInput,
  StatusPill,
  ViewTabs,
  getParam,
  type Column,
} from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { listPages, type PageSummary } from "@/server/content/pages";
import { SYSTEM_PAGE_KEYS, contentPageHref } from "@/server/content/rules";
import { copy } from "./_copy";
import { EnsureSystemPagesButton, NewPageButton, PageRowActions } from "./_components/ListActions";

const t = copy.list;

export const metadata: Metadata = { title: copy.title };

const VIEWS = ["published", "drafts", "system"] as const;
type View = (typeof VIEWS)[number] | null;

function matchesView(p: PageSummary, view: View) {
  if (view === "published") return p.publishedAt !== null;
  if (view === "drafts") return p.publishedAt === null;
  if (view === "system") return p.systemKey !== null;
  return true;
}

export default async function PagesListPage({ searchParams }: PageProps<"/admin/pages">) {
  const sp = await searchParams;
  const basePath = "/admin/pages";
  const ctx = await requireStaffContext();
  const pages = await listPages(ctx);

  const rawView = getParam(sp, "view");
  const view: View = (VIEWS as readonly string[]).includes(rawView ?? "") ? (rawView as View) : null;
  const q = (getParam(sp, "q") ?? "").trim().toLowerCase();
  const rows = pages.filter((p) => matchesView(p, view) && (!q || p.title.toLowerCase().includes(q) || p.slug.includes(q)));

  const haveKeys = new Set(pages.map((p) => p.systemKey).filter(Boolean));
  const missing = SYSTEM_PAGE_KEYS.filter((k) => !haveKeys.has(k));
  const now = new Date();

  const columns: Column<PageSummary>[] = [
    {
      key: "title",
      header: t.columns.title,
      cell: (p) => (
        <div className="grid min-w-0 gap-0.5">
          <Link href={`${basePath}/${p.id}`} className="truncate font-medium text-ink hover:underline">
            {p.title}
          </Link>
          <span className="truncate font-mono text-xs text-muted">{contentPageHref(p)}</span>
        </div>
      ),
    },
    {
      key: "role",
      header: t.columns.role,
      hideBelow: "sm",
      cell: (p) =>
        p.systemKey ? (
          <span className="type-label rounded-[3px] border border-line-strong bg-panel-2 px-1.5 py-px text-[11px] tracking-[0.08em] text-ink-2">
            {p.systemKey}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "status",
      header: t.columns.status,
      cell: (p) => (p.publishedAt ? <StatusPill tone="ok">{t.published}</StatusPill> : <StatusPill tone="mute">{t.draft}</StatusPill>),
    },
    { key: "blocks", header: t.columns.blocks, numeric: true, hideBelow: "md", cell: (p) => p.blockCount },
    { key: "updated", header: t.columns.updated, hideBelow: "md", cell: (p) => <DateTime value={p.updatedAt} format="relative" now={now} /> },
    {
      key: "actions",
      header: <span className="sr-only">{t.columns.actions}</span>,
      align: "right",
      cell: (p) => <PageRowActions id={p.id} title={p.title} systemKey={p.systemKey} />,
    },
  ];

  const counts = {
    all: pages.length,
    published: pages.filter((p) => p.publishedAt).length,
    drafts: pages.filter((p) => !p.publishedAt).length,
    system: pages.filter((p) => p.systemKey).length,
  };

  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} actions={<NewPageButton />} />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        {missing.length > 0 && pages.length > 0 && (
          <InlineAlert tone="warn" title={t.ensureSystemHint(missing.length)} action={<EnsureSystemPagesButton />}>
            Missing: {missing.map((k) => copy.roles[k] ?? k).join(", ")}.
          </InlineAlert>
        )}
        <DataTable
          caption={t.caption}
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id}
          rowLabel={(p) => p.title}
          toolbar={
            <>
              <ViewTabs
                basePath={basePath}
                searchParams={sp}
                active={view}
                views={[
                  { value: null, label: t.views.all, count: counts.all },
                  { value: "published", label: t.views.published, count: counts.published },
                  { value: "drafts", label: t.views.drafts, count: counts.drafts },
                  { value: "system", label: t.views.system, count: counts.system },
                ]}
              />
              <FilterBar end={<ClearFiltersLink params={["q"]} basePath={basePath} searchParams={sp} />}>
                <SearchInput label={t.search} placeholder={t.search} />
              </FilterBar>
            </>
          }
          empty={
            pages.length === 0 ? (
              <EmptyState title={t.emptyTitle} body={t.emptyBody} action={<EnsureSystemPagesButton variant="primary" />} />
            ) : (
              <EmptyState compact title={t.noMatchTitle} body={t.noMatchBody} />
            )
          }
        />
      </div>
    </>
  );
}
