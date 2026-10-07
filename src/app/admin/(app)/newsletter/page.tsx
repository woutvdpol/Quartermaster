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
  ViewTabs,
  buttonClasses,
  getParam,
  parsePage,
  type Column,
  type SearchParamsRecord,
  type StatusTone,
} from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import {
  getNewsletterQuota,
  listCampaigns,
  listSubscribers,
  subscriberCounts,
  type CampaignRow,
  type SubscriberRow,
  type SubscriberStatus,
} from "@/server/newsletter";
import { getTenantInfo } from "../_system/tenant";
import { copy } from "./_copy";
import { NewsletterDisabled } from "./_components/NewsletterDisabled";
import { CampaignStatusPill } from "./_components/CampaignStatusPill";
import { StatsStrip } from "./_components/StatsStrip";
import { SubscriberBulkBar } from "./_components/SubscriberBulkBar";
import { formatCount } from "./_components/format";

export const metadata: Metadata = { title: copy.title };

const BASE = "/admin/newsletter";
const PAGE_SIZE = 50;

type View = SubscriberStatus | "all";
const VIEWS: readonly View[] = ["active", "pending", "unsubscribed", "all"];

function parseView(value: string | undefined): View {
  return VIEWS.includes(value as View) && value ? (value as View) : "active";
}

const SUB_TONE: Record<SubscriberStatus, StatusTone> = {
  active: "ok",
  pending: "warn",
  unsubscribed: "mute",
};

export default async function NewsletterPage({
  searchParams,
}: PageProps<"/admin/newsletter">) {
  const sp = (await searchParams) as SearchParamsRecord;
  const ctx = await requireStaffContext();
  const [quota, tenant] = await Promise.all([
    getNewsletterQuota(ctx),
    getTenantInfo(ctx.tenantId),
  ]);

  if (!quota.enabled) {
    return (
      <>
        <PageHeader crumb={copy.crumb} title={copy.title} />
        <div className="p-4 md:px-[22px] md:py-5">
          <NewsletterDisabled />
        </div>
      </>
    );
  }

  const tab =
    getParam(sp, "tab") === "subscribers" ? "subscribers" : "campaigns";
  const counts = await subscriberCounts(ctx);

  return (
    <>
      <PageHeader
        crumb={copy.crumb}
        title={copy.title}
        actions={
          <Link
            href={`${BASE}/campaigns/new`}
            className={buttonClasses({ variant: "primary" })}
          >
            {copy.newCampaign}
          </Link>
        }
      />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <StatsStrip counts={counts} quota={quota} timeZone={tenant.timezone} />

        <ViewTabs
          label={copy.tabs.label}
          param="tab"
          basePath={BASE}
          searchParams={{ tab: sp.tab }}
          active={tab === "subscribers" ? "subscribers" : null}
          className="rounded-card border border-line bg-panel shadow-card"
          views={[
            { value: null, label: copy.tabs.campaigns },
            {
              value: "subscribers",
              label: copy.tabs.subscribers,
              count: counts.total,
            },
          ]}
        />

        {tab === "campaigns" ? (
          <CampaignsTable ctx={ctx} timeZone={tenant.timezone} />
        ) : (
          <SubscribersTable
            ctx={ctx}
            sp={sp}
            counts={counts}
            timeZone={tenant.timezone}
          />
        )}
      </div>
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requireStaffContext>>;

async function CampaignsTable({
  ctx,
  timeZone,
}: {
  ctx: Ctx;
  timeZone: string;
}) {
  const rows = await listCampaigns(ctx);
  const t = copy.campaigns;
  const columns: Column<CampaignRow>[] = [
    {
      key: "subject",
      header: t.subject,
      cell: (r) => (
        <Link
          href={`${BASE}/campaigns/${r.id}`}
          className="font-medium text-ink hover:underline"
        >
          {r.subject}
        </Link>
      ),
    },
    {
      key: "status",
      header: t.status,
      cell: (r) => <CampaignStatusPill status={r.status} />,
    },
    {
      key: "recipients",
      header: t.recipients,
      numeric: true,
      cell: (r) => (r.status === "DRAFT" ? "—" : formatCount(r.recipientCount)),
    },
    {
      key: "sent",
      header: t.sent,
      numeric: true,
      hideBelow: "md",
      cell: (r) => (r.status === "DRAFT" ? "—" : formatCount(r.sentCount)),
    },
    {
      key: "failed",
      header: t.failed,
      numeric: true,
      hideBelow: "md",
      cell: (r) =>
        r.status === "DRAFT" ? (
          "—"
        ) : (
          <span className={r.failedCount > 0 ? "text-crit" : undefined}>
            {formatCount(r.failedCount)}
          </span>
        ),
    },
    {
      key: "date",
      header: t.sentAt,
      hideBelow: "sm",
      cell: (r) =>
        r.sentAt ? (
          <DateTime value={r.sentAt} timeZone={timeZone} />
        ) : (
          <span className="text-muted">
            {t.updated}{" "}
            <DateTime value={r.updatedAt} format="date" timeZone={timeZone} />
          </span>
        ),
    },
  ];

  return (
    <DataTable
      caption={t.caption}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      empty={
        <EmptyState
          compact
          title={t.emptyTitle}
          body={t.emptyBody}
          action={
            <Link
              href={`${BASE}/campaigns/new`}
              className={buttonClasses({ variant: "primary" })}
            >
              {copy.newCampaign}
            </Link>
          }
        />
      }
    />
  );
}

async function SubscribersTable({
  ctx,
  sp,
  counts,
  timeZone,
}: {
  ctx: Ctx;
  sp: SearchParamsRecord;
  counts: {
    active: number;
    pending: number;
    unsubscribed: number;
    total: number;
  };
  timeZone: string;
}) {
  const t = copy.subscribers;
  const view = parseView(getParam(sp, "status"));
  const q = (getParam(sp, "q") ?? "").trim().slice(0, 254);
  const page = parsePage(sp.page);
  const { items, total } = await listSubscribers(ctx, {
    status: view,
    search: q || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const exportParams = new URLSearchParams({ status: view });
  if (q) exportParams.set("q", q);

  const columns: Column<SubscriberRow>[] = [
    {
      key: "email",
      header: t.email,
      cell: (r) => <span className="font-medium break-all">{r.email}</span>,
    },
    {
      key: "status",
      header: t.status,
      cell: (r) => (
        <StatusPill tone={SUB_TONE[r.status]}>
          {t.statusLabel[r.status]}
        </StatusPill>
      ),
    },
    {
      key: "source",
      header: t.source,
      hideBelow: "md",
      cell: (r) => r.source ?? <span className="text-muted">—</span>,
    },
    {
      key: "created",
      header: t.subscribed,
      hideBelow: "sm",
      cell: (r) => (
        <DateTime value={r.createdAt} format="date" timeZone={timeZone} />
      ),
    },
    {
      key: "changed",
      header: view === "unsubscribed" ? t.unsubscribed : t.confirmed,
      hideBelow: "md",
      cell: (r) => (
        <DateTime
          value={view === "unsubscribed" ? r.unsubscribedAt : r.confirmedAt}
          format="date"
          timeZone={timeZone}
        />
      ),
    },
  ];

  const tabParams = { ...sp, tab: "subscribers" };

  return (
    <DataTable
      caption={t.caption}
      columns={columns}
      rows={items}
      rowKey={(r) => r.id}
      rowLabel={(r) => r.email}
      selectable
      toolbar={
        <>
          <ViewTabs
            basePath={BASE}
            searchParams={tabParams}
            param="status"
            active={view === "active" ? null : view}
            views={[
              { value: null, label: t.views.active, count: counts.active },
              {
                value: "pending",
                label: t.views.pending,
                count: counts.pending,
              },
              {
                value: "unsubscribed",
                label: t.views.unsubscribed,
                count: counts.unsubscribed,
              },
              { value: "all", label: t.views.all, count: counts.total },
            ]}
          />
          <FilterBar
            end={
              <>
                <ClearFiltersLink
                  params={["q"]}
                  basePath={BASE}
                  searchParams={tabParams}
                />
                <a
                  href={`${BASE}/export?${exportParams.toString()}`}
                  download
                  title={t.exportHint}
                  className={buttonClasses({ size: "sm" })}
                >
                  {t.export}
                </a>
              </>
            }
          >
            <SearchInput label={t.searchLabel} placeholder={t.search} />
          </FilterBar>
          <SubscriberBulkBar />
        </>
      }
      empty={
        <EmptyState
          compact
          title={t.emptyTitle}
          body={q ? t.emptySearch : t.emptyBody}
        />
      }
      footer={
        total > PAGE_SIZE ? (
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            basePath={BASE}
            searchParams={tabParams}
          />
        ) : undefined
      }
    />
  );
}
