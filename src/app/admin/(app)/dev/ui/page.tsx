import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Card,
  ClearFiltersLink,
  DataTable,
  DataTableSkeleton,
  DateTime,
  EmptyState,
  FilterBar,
  FilterChip,
  FilterSelect,
  FulfillmentStatusPill,
  InlineAlert,
  KeyValue,
  Money,
  PageHeader,
  Pagination,
  parsePage,
  parseSort,
  PaymentStatusPill,
  ProductStatusPill,
  SearchInput,
  Skeleton,
  SkeletonText,
  Thumb,
  Timeline,
  Toaster,
  Tooltip,
  ViewTabs,
  buttonClasses,
  getParam,
  type Column,
} from "@/components/admin/ui";
import type { ProductStatus } from "@/generated/prisma/enums";
import { demoBulkAction } from "./actions";
import { DemoForm, DropzoneDemo, FeedbackDemo } from "./demo-client";

export const metadata: Metadata = { title: "UI kit" };

/* Kitchen sink for the admin UI kit (src/components/admin/ui). Development only. */

type DemoRow = { id: string; title: string; sku: string; status: ProductStatus; price: number; stock: number; updated: string };

const STATUSES: ProductStatus[] = ["ACTIVE", "RESERVED", "SOLD", "DRAFT", "ARCHIVED", "STOLEN"];
const NAMES = ["M35 helmet", "Iron Cross 2nd class", "Feldbluse M40", "Luftwaffe dagger", "Kriegsmarine cap", "Mess kit", "Field telephone", "Bread bag"];
const ROWS: DemoRow[] = Array.from({ length: 23 }, (_, i) => ({
  id: `p${i + 1}`,
  title: `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` #${Math.floor(i / NAMES.length) + 1}` : ""}`,
  sku: `QM-${1040 + i}`,
  status: STATUSES[i % STATUSES.length],
  price: 4500 + ((i * 7919) % 90000),
  stock: i % 4 === 0 ? 0 : 1,
  updated: new Date(Date.UTC(2026, 9, 7, 12) - i * 5.5 * 3600_000).toISOString(),
}));
const PAGE_SIZE = 8;
const SORTS = ["title", "price", "updated"] as const;

export default async function UiKitPage({ searchParams }: PageProps<"/admin/dev/ui">) {
  if (process.env.NODE_ENV === "production") notFound();
  const sp = await searchParams;
  const basePath = "/admin/dev/ui";

  const view = getParam(sp, "view") ?? null;
  const q = (getParam(sp, "q") ?? "").toLowerCase();
  const status = getParam(sp, "status");
  const sort = parseSort(sp.sort, SORTS);
  let rows = ROWS.filter(
    (r) =>
      (!view || (view === "forSale" ? r.status === "ACTIVE" : r.status === "SOLD")) &&
      (!status || r.status === status) &&
      (!q || r.title.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q)),
  );
  if (sort) {
    rows = [...rows].sort((a, b) => {
      const d = sort.key === "price" ? a.price - b.price : String(a[sort.key]).localeCompare(String(b[sort.key]));
      return sort.dir === "asc" ? d : -d;
    });
  }
  const page = parsePage(sp.page);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const now = new Date(Date.UTC(2026, 9, 7, 14));

  const columns: Column<DemoRow>[] = [
    {
      key: "title",
      header: "Item",
      sortKey: "title",
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <Thumb alt="" size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-medium">{r.title}</span>
            <span className="block font-mono text-[11.5px] text-muted">{r.sku}</span>
          </span>
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (r) => <ProductStatusPill status={r.status} /> },
    { key: "stock", header: "Stock", numeric: true, hideBelow: "md", cell: (r) => r.stock },
    { key: "price", header: "Price", numeric: true, sortKey: "price", cell: (r) => <Money amount={r.price} mono /> },
    {
      key: "updated",
      header: "Updated",
      sortKey: "updated",
      hideBelow: "sm",
      align: "right",
      cell: (r) => <DateTime value={r.updated} format="relative" now={now} className="text-muted" />,
    },
  ];

  return (
    <>
      <PageHeader crumb="Development" title="UI kit" />
      <Toaster />
      <div className="grid content-start gap-5 p-4 md:px-[22px] md:py-5">
        <InlineAlert tone="info" title="Development only">
          This page renders only when NODE_ENV is not production. Usage: src/components/admin/ui/README.md.
        </InlineAlert>

        <Section title="Data table">
          <DataTable
            caption="Demo inventory"
            columns={columns}
            rows={pageRows}
            rowKey={(r) => r.id}
            rowLabel={(r) => r.title}
            selectable
            bulkAction={demoBulkAction}
            bulkActions={
              <>
                <button type="submit" name="op" value="publish" className={buttonClasses({ size: "sm" })}>
                  Publish
                </button>
                <button type="submit" name="op" value="archive" className={buttonClasses({ size: "sm" })}>
                  Archive
                </button>
              </>
            }
            sorting={{ sort: getParam(sp, "sort"), basePath, searchParams: sp }}
            toolbar={
              <>
                <ViewTabs
                  basePath={basePath}
                  searchParams={sp}
                  active={view}
                  views={[
                    { value: null, label: "All", count: ROWS.length },
                    { value: "forSale", label: "For sale", count: ROWS.filter((r) => r.status === "ACTIVE").length },
                    { value: "sold", label: "Sold", count: ROWS.filter((r) => r.status === "SOLD").length },
                  ]}
                />
                <FilterBar end={<ClearFiltersLink params={["q", "status"]} basePath={basePath} searchParams={sp} />}>
                  <SearchInput placeholder="Search title or SKU…" />
                  <FilterSelect
                    param="status"
                    label="Status"
                    options={STATUSES.map((s) => ({ value: s, label: s.toLowerCase() }))}
                  />
                  <FilterChip param="q" label="Search" basePath={basePath} searchParams={sp} />
                </FilterBar>
              </>
            }
            footer={<Pagination page={page} pageSize={PAGE_SIZE} total={rows.length} basePath={basePath} searchParams={sp} />}
          />
          <div className="grid gap-3 lg:grid-cols-2">
            <DataTableSkeleton columns={4} rows={3} label="Loading demo" />
            <Card padded={false}>
              <EmptyState
                title="No orders yet"
                body="Orders appear here once a customer completes checkout."
                action={<a href="#" className={buttonClasses({ variant: "primary" })}>Share your shop</a>}
              />
            </Card>
          </div>
        </Section>

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Section title="Form">
            <Card title="Product">
              <DemoForm />
            </Card>
          </Section>
          <Section title="Feedback">
            <Card>
              <FeedbackDemo />
            </Card>
            <div className="grid gap-2">
              <InlineAlert tone="ok">Payment received via iDEAL.</InlineAlert>
              <InlineAlert tone="warn" title="Reserved">In a customer&apos;s cart for 12 more minutes.</InlineAlert>
              <InlineAlert tone="crit" title="Payment failed" action={<a className={buttonClasses({ size: "sm" })} href="#">Retry</a>}>
                The item is available again.
              </InlineAlert>
            </div>
            <Card title="Skeleton & tooltip">
              <div className="grid gap-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-10" />
                  <SkeletonText lines={2} className="flex-1" />
                </div>
                <Tooltip content="Margin = price − purchase price">
                  <button type="button" className={buttonClasses({ size: "sm" })}>
                    Hover or focus me
                  </button>
                </Tooltip>
              </div>
            </Card>
          </Section>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Display">
            <Card title="Order #1042">
              <div className="grid gap-4">
                <div className="flex flex-wrap gap-2">
                  <PaymentStatusPill status="PAID" />
                  <PaymentStatusPill status="PENDING" />
                  <PaymentStatusPill status="FAILED" />
                  <FulfillmentStatusPill status="UNFULFILLED" />
                  <FulfillmentStatusPill status="SHIPPED" />
                  <ProductStatusPill status="RESERVED" />
                </div>
                <KeyValue
                  items={[
                    { label: "Subtotal", value: <Money amount={39500} /> },
                    { label: "Shipping", value: <Money amount={1295} /> },
                    { label: "Refund", value: <Money amount={-2500} signed /> },
                    { label: "Placed", value: <DateTime value="2026-10-07T09:12:00Z" /> },
                    { label: "Unknown", value: <Money amount={null} /> },
                  ]}
                />
                <KeyValue
                  layout="stacked"
                  items={[
                    { label: "SKU", value: "QM-1042", mono: true },
                    { label: "Provenance", value: "Estate of a Normandy veteran" },
                  ]}
                />
                <div className="flex items-end gap-2">
                  <Thumb alt="Helmet" size="xs" />
                  <Thumb alt="Helmet" size="sm" />
                  <Thumb alt="Helmet" size="md" placeholderLabel="NO IMG" />
                  <Thumb alt="Helmet" size="lg" placeholderLabel="4:3" />
                </div>
              </div>
            </Card>
          </Section>
          <Section title="Timeline">
            <Card>
              <Timeline
                items={[
                  { title: "Shipped with PostNL", meta: "07-10 14:02 · Wout", highlight: true },
                  { title: "Payment received", meta: "07-10 09:14 · Mollie webhook", tone: "ok" },
                  { title: "Order placed", meta: "07-10 09:12 · storefront", body: "Customer note: please pack well." },
                ]}
              />
            </Card>
          </Section>
        </div>

        <Section title="Media">
          <Card>
            <DropzoneDemo />
          </Card>
        </Section>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid content-start gap-3">
      <h2 className="type-label text-sm text-muted">{title}</h2>
      {children}
    </section>
  );
}
