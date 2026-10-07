import type { Metadata } from "next";
import Link from "next/link";
import {
  ClearFiltersLink,
  DataTable,
  DateTime,
  EmptyState,
  FilterBar,
  FilterChip,
  FilterSelect,
  Money,
  PageHeader,
  Pagination,
  SearchInput,
  StatusPill,
  getParam,
  parsePage,
  type Column,
} from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { ANONYMIZED_EMAIL_DOMAIN, listCustomers } from "@/server/customers";
import { requireTenantDisplay } from "@/server/tenant-display";
import { customersCopy as t } from "./_copy";

export const metadata: Metadata = { title: t.title };

const BASE = "/admin/customers";
const PAGE_SIZE = 50;
const SORTS = ["lastOrder", "name", "created", "revenue"] as const;
type Sort = (typeof SORTS)[number];

type Row = Awaited<ReturnType<typeof listCustomers>>["items"][number];

export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  const sp = await searchParams;
  const ctx = await requireStaffContext();
  const sortParam = getParam(sp, "sort");
  const sort: Sort = (SORTS as readonly string[]).includes(sortParam ?? "") ? (sortParam as Sort) : "lastOrder";
  const q = getParam(sp, "q")?.slice(0, 200);
  const page = parsePage(sp.page);

  const [list, display] = await Promise.all([
    listCustomers(ctx, { search: q, sort, page, pageSize: PAGE_SIZE }),
    requireTenantDisplay(ctx.tenantId),
  ]);

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: t.columns.name,
      cell: (c) => (
        <Link href={`${BASE}/${c.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
          {c.name || <span className="text-muted">{t.noName}</span>}
        </Link>
      ),
    },
    {
      key: "email",
      header: t.columns.email,
      hideBelow: "md",
      cell: (c) => <span className="text-ink-2">{c.email.endsWith(`@${ANONYMIZED_EMAIL_DOMAIN}`) ? "—" : c.email}</span>,
    },
    {
      key: "type",
      header: t.columns.type,
      hideBelow: "sm",
      cell: (c) =>
        c.email.endsWith(`@${ANONYMIZED_EMAIL_DOMAIN}`) ? (
          <StatusPill tone="mute">{t.anonymized}</StatusPill>
        ) : c.registered ? (
          <StatusPill tone="info">{t.registered}</StatusPill>
        ) : (
          <StatusPill tone="mute">{t.guest}</StatusPill>
        ),
    },
    {
      key: "orders",
      header: t.columns.orders,
      numeric: true,
      cell: (c) => (
        <span className="font-mono">
          {c.orderCount}
          {c.paidOrderCount !== c.orderCount && <span className="text-muted">{t.paidSuffix(c.paidOrderCount)}</span>}
        </span>
      ),
    },
    {
      key: "revenue",
      header: t.columns.revenue,
      numeric: true,
      cell: (c) => <Money amount={c.paidRevenue} currency={display.currency} mono />,
    },
    {
      key: "lastOrder",
      header: t.columns.lastOrder,
      align: "right",
      hideBelow: "sm",
      cell: (c) => <DateTime value={c.lastOrderAt} format="date" timeZone={display.timeZone} className="text-muted" />,
    },
  ];

  return (
    <>
      <PageHeader crumb={t.crumb} title={t.title} />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <DataTable
          caption={t.caption}
          columns={columns}
          rows={list.items}
          rowKey={(c) => c.id}
          empty={
            q ? (
              <EmptyState compact title={t.empty.title} body={t.empty.body} />
            ) : (
              <EmptyState compact title={t.empty.noneYet} body={t.empty.noneYetBody} />
            )
          }
          toolbar={
            <FilterBar end={<ClearFiltersLink params={["q", "sort"]} basePath={BASE} searchParams={sp} />}>
              <SearchInput label={t.search.label} placeholder={t.search.placeholder} />
              <FilterSelect
                param="sort"
                label={t.sort.label}
                anyLabel={t.sort.lastOrder}
                options={[
                  { value: "name", label: t.sort.name },
                  { value: "created", label: t.sort.created },
                  { value: "revenue", label: t.sort.revenue },
                ]}
              />
              <FilterChip param="q" label={t.search.chip} basePath={BASE} searchParams={sp} />
            </FilterBar>
          }
          footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.total} basePath={BASE} searchParams={sp} />}
        />
      </div>
    </>
  );
}
