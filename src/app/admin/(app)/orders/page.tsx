import type { Metadata } from "next";
import Link from "next/link";
import {
  ClearFiltersLink,
  DataTable,
  DateTime,
  EmptyState,
  FilterBar,
  FilterChip,
  FulfillmentStatusPill,
  Money,
  PageHeader,
  Pagination,
  PaymentStatusPill,
  SearchInput,
  ViewTabs,
  buttonClasses,
  formatDate,
  getParam,
  hrefWith,
  parsePage,
  type Column,
} from "@/components/admin/ui";
import { requireStaffContext, ServiceError } from "@/server/context";
import { getOrder, listOrders, ORDER_VIEWS, type OrderListItem, type OrderView } from "@/server/orders/queries";
import { ordersCopy as t } from "./_copy";
import { BulkArchive } from "./_components/BulkArchive";
import { DateRangeFilter } from "./_components/DateRangeFilter";
import { OrderDrawer } from "./_components/OrderDrawer";
import { OrderSummary } from "./_components/OrderSummary";
import { dayRange, parseDay, startOfLocalDay } from "./_lib/dates";
import { countryName, paymentMethodLabel } from "./_lib/labels";
import { requireTenantDisplay } from "@/server/tenant-display";

export const metadata: Metadata = { title: t.title };

const BASE = "/admin/orders";
const PAGE_SIZE = 50;

function parseView(value: string | undefined): OrderView {
  return (ORDER_VIEWS as readonly string[]).includes(value ?? "") ? (value as OrderView) : "open";
}

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const sp = await searchParams;
  const ctx = await requireStaffContext();
  const display = await requireTenantDisplay(ctx.tenantId);

  const view = parseView(getParam(sp, "view"));
  const q = getParam(sp, "q")?.slice(0, 200);
  const fromParam = getParam(sp, "from");
  const toParam = getParam(sp, "to");
  const range = dayRange(fromParam, toParam, display.timeZone);
  const page = parsePage(sp.page);
  const drawerId = getParam(sp, "order");

  const [list, drawerOrder] = await Promise.all([
    listOrders(ctx, {
      view,
      search: q,
      from: range.from,
      to: range.to,
      page,
      pageSize: PAGE_SIZE,
    }),
    drawerId
      ? getOrder(ctx, drawerId).catch((e) => {
          if (e instanceof ServiceError && e.code === "NOT_FOUND") return null;
          throw e;
        })
      : Promise.resolve(null),
  ]);

  const dayLabel = (value: string | undefined) => {
    const day = parseDay(value);
    return day ? formatDate(startOfLocalDay(day, display.timeZone), "date", display.timeZone) : value;
  };
  const hasFilters = Boolean(q || fromParam || toParam);
  const totalOrders = list.counts.all;

  const columns: Column<OrderListItem>[] = [
    {
      key: "number",
      header: t.columns.number,
      width: "96px",
      cell: (o) => (
        <Link
          href={hrefWith(BASE, sp, { order: o.id })}
          scroll={false}
          prefetch={false}
          className="font-mono font-medium text-ink underline-offset-2 after:absolute after:inset-0 hover:underline"
        >
          #{o.number}
        </Link>
      ),
    },
    {
      key: "customer",
      header: t.columns.customer,
      cell: (o) => (
        <div className="min-w-0">
          <div className="truncate">{o.customerName}</div>
          <div className="truncate text-xs text-muted">
            {[o.shipTo ? countryName(o.shipTo.countryCode) : null, t.items(o.lineCount)].filter(Boolean).join(" · ")}
          </div>
        </div>
      ),
    },
    {
      key: "payment",
      header: t.columns.payment,
      cell: (o) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <PaymentStatusPill status={o.paymentStatus} />
          {paymentMethodLabel(o.paymentMethod) && (
            <span className="text-xs text-muted">{paymentMethodLabel(o.paymentMethod)}</span>
          )}
        </span>
      ),
    },
    {
      key: "fulfillment",
      header: t.columns.fulfillment,
      hideBelow: "md",
      cell: (o) => <FulfillmentStatusPill status={o.fulfillmentStatus} />,
    },
    {
      key: "total",
      header: t.columns.total,
      numeric: true,
      cell: (o) => <Money amount={o.total} currency={o.currency} mono />,
    },
    {
      key: "placed",
      header: t.columns.placed,
      align: "right",
      hideBelow: "sm",
      cell: (o) => <DateTime value={o.placedAt} timeZone={display.timeZone} className="text-muted" />,
    },
  ];

  return (
    <>
      <PageHeader
        crumb={t.crumb}
        title={t.title}
        actions={
          <Link href="/admin/shipping-board" className={buttonClasses()}>
            {t.boardLink}
          </Link>
        }
      />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <DataTable
          caption={t.listCaption}
          columns={columns}
          rows={list.items}
          rowKey={(o) => o.id}
          rowLabel={(o) => `#${o.number} ${o.customerName}`}
          rowClassName={(o) =>
            `relative cursor-pointer [&>td:first-child]:relative [&>td:first-child]:z-[1]${o.id === drawerOrder?.id ? " bg-accent-soft" : ""}`
          }
          selectable={view !== "archived"}
          bulkActions={<BulkArchive />}
          empty={
            hasFilters || totalOrders > 0 ? (
              <EmptyState compact title={t.empty.title} body={t.empty.body} />
            ) : (
              <EmptyState compact title={t.empty.noneYet} body={t.empty.noneYetBody} />
            )
          }
          toolbar={
            <>
              <ViewTabs
                basePath={BASE}
                searchParams={sp}
                active={view === "open" ? null : view}
                views={ORDER_VIEWS.map((v) => ({
                  value: v === "open" ? null : v,
                  label: t.views[v],
                  count: list.counts[v],
                }))}
              />
              <FilterBar end={<ClearFiltersLink params={["q", "from", "to"]} basePath={BASE} searchParams={sp} />}>
                <SearchInput label={t.search.label} placeholder={t.search.placeholder} />
                <DateRangeFilter />
                <FilterChip param="q" label={t.filterChips.search} basePath={BASE} searchParams={sp} />
                <FilterChip
                  param="from"
                  label={t.filterChips.from}
                  valueLabel={dayLabel(fromParam)}
                  basePath={BASE}
                  searchParams={sp}
                />
                <FilterChip
                  param="to"
                  label={t.filterChips.to}
                  valueLabel={dayLabel(toParam)}
                  basePath={BASE}
                  searchParams={sp}
                />
              </FilterBar>
            </>
          }
          footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.total} basePath={BASE} searchParams={sp} />}
        />
      </div>

      {drawerId && (
        <OrderDrawer
          key={drawerId}
          title={drawerOrder ? `#${drawerOrder.number} · ${drawerOrder.customerName}` : t.title}
          description={
            drawerOrder ? (
              <>
                {t.drawer.placed} <DateTime value={drawerOrder.placedAt} timeZone={display.timeZone} />
              </>
            ) : undefined
          }
          footer={
            drawerOrder ? (
              <>
                <a href={`${BASE}/${drawerOrder.id}/packing-slip`} target="_blank" rel="noopener" className={buttonClasses()}>
                  {t.drawer.packingSlip}
                </a>
                <Link href={`${BASE}/${drawerOrder.id}`} className={buttonClasses({ variant: "primary" })}>
                  {t.drawer.openFull}
                </Link>
              </>
            ) : undefined
          }
        >
          {drawerOrder ? (
            <OrderSummary order={drawerOrder} timeZone={display.timeZone} />
          ) : (
            <EmptyState compact title={t.notFound} body={t.drawer.notFound} />
          )}
        </OrderDrawer>
      )}
    </>
  );
}
