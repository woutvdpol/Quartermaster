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
  ViewTabs,
  formatMoney,
  getParam,
  parsePage,
  type Column,
} from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { listCoupons, type CouponRow } from "@/server/coupons";
import { requireTenantDisplay } from "@/server/tenant-display";
import { CouponDrawer } from "./_components/CouponDrawer";
import { couponsCopy as t } from "./_copy";
import { couponState, describeDiscount, STATE_TONE } from "./_format";

export const metadata: Metadata = { title: "Coupons" };

const BASE = "/admin/coupons";
const PAGE_SIZE = 50;
const VIEWS = ["all", "active", "scheduled", "ended", "inactive"] as const;
type View = (typeof VIEWS)[number];

export default async function CouponsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaffContext();
  const v = getParam(sp, "view");
  const view: View = (VIEWS as readonly string[]).includes(v ?? "") ? (v as View) : "all";
  const page = parsePage(sp.page);
  const [list, tenant] = await Promise.all([listCoupons(ctx, { view, q: getParam(sp, "q"), page, pageSize: PAGE_SIZE }), requireTenantDisplay(ctx.tenantId)]);
  const currency = tenant.currency;
  const now = new Date();

  const columns: Column<CouponRow>[] = [
    {
      key: "code",
      header: t.columns.code,
      cell: (r) => (
        <Link href={`${BASE}/${r.id}`} className="grid hover:underline">
          <span className="font-mono font-medium text-ink">{r.code}</span>
          {r.description ? <span className="truncate text-xs text-muted">{r.description}</span> : null}
        </Link>
      ),
    },
    { key: "type", header: t.columns.type, cell: (r) => describeDiscount(r, (n) => formatMoney(n, currency)) },
    { key: "usage", header: t.columns.usage, numeric: true, cell: (r) => `${r.used} / ${r.maxRedemptions ?? t.unlimited}` },
    { key: "given", header: t.columns.given, numeric: true, hideBelow: "md", cell: (r) => <Money amount={r.discountGiven} currency={currency} mono /> },
    {
      key: "window",
      header: t.columns.window,
      hideBelow: "lg",
      cell: (r) =>
        !r.startsAt && !r.endsAt ? (
          <span className="text-muted">{t.always}</span>
        ) : (
          <span className="text-xs">
            {r.startsAt ? <DateTime value={r.startsAt} format="date" timeZone={tenant.timeZone} /> : "…"} – {r.endsAt ? <DateTime value={r.endsAt} format="date" timeZone={tenant.timeZone} /> : "…"}
          </span>
        ),
    },
    {
      key: "status",
      header: t.columns.status,
      cell: (r) => {
        const s = couponState(r, now);
        return <StatusPill tone={STATE_TONE[s]}>{t.status[s]}</StatusPill>;
      },
    },
  ];

  const add = <CouponDrawer trigger={t.add} triggerVariant="primary" currency={currency} />;
  return (
    <>
      <PageHeader crumb={t.crumb} title={t.title} actions={add} />
      <div className="p-4 md:px-[22px] md:py-5">
        <DataTable
          caption={t.title}
          columns={columns}
          rows={list.rows}
          rowKey={(r) => r.id}
          empty={<EmptyState title={t.empty.title} body={t.empty.body} action={list.counts.all === 0 ? add : undefined} compact />}
          toolbar={
            <>
              <ViewTabs basePath={BASE} searchParams={sp} active={view === "all" ? null : view} views={VIEWS.map((x) => ({ value: x === "all" ? null : x, label: t.views[x], count: list.counts[x] }))} />
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
