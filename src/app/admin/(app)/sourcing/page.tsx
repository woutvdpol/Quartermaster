import type { Metadata } from "next";
import Link from "next/link";
import {
  ClearFiltersLink,
  DataTable,
  EmptyState,
  FilterBar,
  FilterSelect,
  Money,
  PageHeader,
  Pagination,
  SearchInput,
  StatusPill,
  formatDate,
  getParam,
  parsePage,
  type Column,
} from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { listPurchaseRecords, listSuppliers } from "@/server/purchasing";
import { copy } from "./_copy";
import { allocatedCostByRecord } from "./_data";
import { getTenantFormat } from "./_lib/tenant";
import { todayIn } from "./_lib/time";
import { RecordFormDrawer } from "./_components/RecordFormDrawer";
import { SourcingTabs } from "./_components/SourcingTabs";

export const metadata: Metadata = { title: `${copy.tabs.records} · ${copy.title}` };

const PAGE_SIZE = 25;
const BASE = "/admin/sourcing";

export default async function PurchaseRecordsPage({ searchParams }: PageProps<"/admin/sourcing">) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const q = getParam(sp, "q")?.slice(0, 200);
  const supplierId = getParam(sp, "supplier")?.slice(0, 64);

  const ctx = await requireStaffContext();
  const [result, suppliers, fmt] = await Promise.all([
    listPurchaseRecords(ctx, { page, pageSize: PAGE_SIZE, search: q || undefined, supplierId: supplierId || undefined }),
    listSuppliers(ctx),
    getTenantFormat(ctx),
  ]);
  const allocated = await allocatedCostByRecord(ctx, result.items.map((r) => r.id));
  type Row = (typeof result.items)[number] & { allocated: number };
  const rows: Row[] = result.items.map((r) => ({ ...r, allocated: allocated.get(r.id) ?? 0 }));
  const filtered = Boolean(q || supplierId);

  const columns: Column<Row>[] = [
    {
      key: "date",
      header: copy.records.date,
      cell: (r) => (
        <Link href={`/admin/sourcing/records/${r.id}`} className="font-medium whitespace-nowrap hover:underline">
          {formatDate(r.purchasedAt, "date", "UTC")}
        </Link>
      ),
    },
    {
      key: "supplier",
      header: copy.records.supplier,
      cell: (r) => (r.supplier ? r.supplier.name : <span className="text-muted">{copy.records.noSupplier}</span>),
    },
    {
      key: "invoice",
      header: copy.records.invoice,
      hideBelow: "md",
      cell: (r) => (r.invoiceNumber ? <span className="font-mono text-xs">{r.invoiceNumber}</span> : <span className="text-muted">—</span>),
    },
    { key: "products", header: copy.records.products, numeric: true, cell: (r) => r.productCount },
    {
      key: "total",
      header: copy.records.totalCost,
      numeric: true,
      cell: (r) => (r.totalCost == null ? <span className="text-muted">{copy.records.noTotal}</span> : <Money amount={r.totalCost} currency={r.currency} mono />),
    },
    { key: "allocated", header: copy.records.allocated, numeric: true, hideBelow: "sm", cell: (r) => <Money amount={r.allocated} currency={r.currency} mono /> },
    {
      key: "unallocated",
      header: copy.records.unallocated,
      numeric: true,
      cell: (r) => {
        if (r.totalCost == null) return <span className="text-muted">—</span>;
        const rest = r.totalCost - r.allocated;
        if (rest === 0) return <StatusPill tone="ok">{copy.records.balanced}</StatusPill>;
        return (
          <StatusPill tone={rest < 0 ? "crit" : "warn"}>
            <Money amount={rest} currency={r.currency} signed={rest < 0} />
          </StatusPill>
        );
      },
    },
  ];

  const drawer = (
    <RecordFormDrawer
      suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
      currency={fmt.currency}
      today={todayIn(fmt.timeZone)}
      triggerLabel={copy.records.new}
    />
  );

  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} actions={drawer} />
      <SourcingTabs active="records" />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <DataTable
          caption={copy.records.caption}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          toolbar={
            <FilterBar end={<ClearFiltersLink params={["q", "supplier"]} basePath={BASE} searchParams={sp} />}>
              <SearchInput placeholder={copy.records.search} label={copy.records.search} />
              {suppliers.length > 0 && (
                <FilterSelect
                  param="supplier"
                  label={copy.records.supplierFilter}
                  anyLabel={copy.records.anySupplier}
                  options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                />
              )}
            </FilterBar>
          }
          empty={
            filtered ? (
              <EmptyState compact title={copy.records.emptyFiltered} body={copy.records.emptyFilteredBody} />
            ) : (
              <EmptyState title={copy.records.empty} body={copy.records.emptyBody} />
            )
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={result.total} basePath={BASE} searchParams={sp} />}
        />
      </div>
    </>
  );
}
