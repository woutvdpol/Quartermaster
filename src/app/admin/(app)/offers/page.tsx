import type { Metadata } from "next";
import Link from "next/link";
import {
  DataTable,
  DateTime,
  EmptyState,
  FilterBar,
  Money,
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
} from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { getOfferDetail, listOffers, OFFER_VIEWS, type OfferRow, type OfferView } from "@/server/offers";
import { requireTenantDisplay } from "@/server/tenant-display";
import { ServiceError } from "@/server/context";
import { OfferDrawer } from "./_components/OfferDrawer";
import { OFFER_STATUS_TONE, offersCopy as t } from "./_copy";

export const metadata: Metadata = { title: "Offers" };

const BASE = "/admin/offers";
const PAGE_SIZE = 50;

function isView(v: string | undefined): v is OfferView {
  return !!v && Object.hasOwn(OFFER_VIEWS, v);
}

export default async function OffersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaffContext();
  const viewParam = getParam(sp, "view");
  const view: OfferView = isView(viewParam) ? viewParam : "pending";
  const page = parsePage(sp.page);
  const q = getParam(sp, "q");
  const openId = getParam(sp, "offer");

  const [list, tenant, detail] = await Promise.all([
    listOffers(ctx, { view, q, page, pageSize: PAGE_SIZE }),
    requireTenantDisplay(ctx.tenantId),
    openId
      ? getOfferDetail(ctx, openId).catch((err) => {
          if (err instanceof ServiceError && err.code === "NOT_FOUND") return null;
          throw err;
        })
      : Promise.resolve(null),
  ]);
  const now = new Date();
  const open = (id: string) => hrefWith(BASE, sp, { offer: id });

  const columns: Column<OfferRow>[] = [
    {
      key: "item",
      header: t.columns.item,
      cell: (r) => (
        <Link href={open(r.id)} scroll={false} className="flex min-w-0 items-center gap-2.5 hover:underline">
          <Thumb src={r.product.thumb} alt="" size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">{r.product.title}</span>
            <span className="font-mono text-xs text-muted">#{r.product.stockCode}</span>
          </span>
        </Link>
      ),
    },
    {
      key: "customer",
      header: t.columns.customer,
      hideBelow: "md",
      cell: (r) => (
        <span className="grid">
          <span className="text-ink">{r.name}</span>
          <span className="text-xs text-muted">{r.email}</span>
        </span>
      ),
    },
    { key: "offer", header: t.columns.offer, numeric: true, cell: (r) => <Money amount={r.amount} currency={r.currency} mono /> },
    { key: "price", header: t.columns.price, numeric: true, hideBelow: "sm", cell: (r) => <Money amount={r.product.price} currency={r.currency} mono /> },
    { key: "pct", header: t.columns.pct, numeric: true, hideBelow: "md", cell: (r) => (r.percent === null ? "—" : `${r.percent}%`) },
    { key: "status", header: t.columns.status, cell: (r) => <StatusPill tone={OFFER_STATUS_TONE[r.status]}>{t.status[r.status]}</StatusPill> },
    { key: "received", header: t.columns.received, hideBelow: "lg", cell: (r) => <DateTime value={r.createdAt} format="relative" now={now} timeZone={tenant.timeZone} /> },
  ];

  const views = (Object.keys(t.views) as OfferView[]).map((v) => ({ value: v === "pending" ? null : v, label: t.views[v], count: list.counts[v] }));

  return (
    <>
      <PageHeader crumb={t.crumb} title={t.title} />
      <div className="p-4 md:px-[22px] md:py-5">
        <DataTable
          caption={t.title}
          columns={columns}
          rows={list.rows}
          rowKey={(r) => r.id}
          rowClassName={(r) => (r.id === openId ? "bg-accent-soft" : undefined)}
          empty={<EmptyState title={t.empty.title} body={t.empty.body} compact />}
          toolbar={
            <>
              <ViewTabs basePath={BASE} searchParams={sp} active={view === "pending" ? null : view} views={views} />
              <FilterBar>
                <SearchInput placeholder={t.search} />
              </FilterBar>
            </>
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={list.total} basePath={BASE} searchParams={sp} />}
        />
      </div>
      {detail ? <OfferDrawer key={detail.id} offer={detail} closeHref={hrefWith(BASE, sp, { offer: null })} timeZone={tenant.timeZone} /> : null}
    </>
  );
}
