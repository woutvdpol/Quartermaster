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
  ProductStatusPill,
  SearchInput,
  Thumb,
  ViewTabs,
  buttonClasses,
  formatDate,
  formatMoney,
  getParam,
  parsePage,
  parseSort,
  type Column,
  type SearchParamsRecord,
} from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { listCategoryTree } from "@/server/catalog/categories";
import { PRODUCT_SORTS, PRODUCT_VIEWS, listProducts, statusBlocker, type ProductListRow, type ProductView } from "@/server/catalog/products";
import { listTags } from "@/server/catalog/tags";
import { listPurchaseRecords } from "@/server/purchasing";
import { stockOverview } from "@/server/stock/ledger";
import { imageUrl } from "@/server/media/product-images";
import { copy } from "./_copy";
import { requireTenantDisplay } from "@/server/tenant-display";
import { flattenCategories } from "./_data";
import { BulkActions, type BulkRowMeta } from "./_components/BulkActions";
import { PriceRangeFilter } from "./_components/PriceRangeFilter";
import { ReservationCountdown } from "./_components/ReservationCountdown";

export const metadata: Metadata = { title: copy.title };

const BASE = "/admin/inventory";
const PAGE_SIZE = 25;
/** The tab without a `view` param. */
const DEFAULT_VIEW: ProductView = "forSale";
const TAB_ORDER: ProductView[] = ["forSale", "inCart", "draft", "sold", "archived", "noPhoto", "all"];
const FILTER_PARAMS = ["q", "category", "tag", "pmin", "pmax", "purchase"];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function parseView(raw: string | undefined): ProductView {
  return raw && (PRODUCT_VIEWS as readonly string[]).includes(raw) ? (raw as ProductView) : DEFAULT_VIEW;
}

function parseMinor(raw: string | undefined): number | undefined {
  if (!raw || !/^\d{1,10}$/.test(raw)) return undefined;
  const n = Number(raw);
  return n <= 1_000_000_000 ? n : undefined;
}

function parseId(raw: string | undefined): string | undefined {
  return raw && ID_RE.test(raw) ? raw : undefined;
}

export default async function InventoryPage({ searchParams }: PageProps<"/admin/inventory">) {
  const sp = (await searchParams) as SearchParamsRecord;
  const ctx = await requireStaffContext();

  const view = parseView(getParam(sp, "view"));
  const page = parsePage(sp.page);
  const sort = parseSort(sp.sort, PRODUCT_SORTS);
  const q = getParam(sp, "q")?.trim().slice(0, 200) || undefined;
  const categoryParam = getParam(sp, "category");
  const categoryId = categoryParam === "none" ? null : parseId(categoryParam);
  const tagId = parseId(getParam(sp, "tag"));
  const purchaseRecordId = parseId(getParam(sp, "purchase"));
  const priceMin = parseMinor(getParam(sp, "pmin"));
  const priceMax = parseMinor(getParam(sp, "pmax"));

  const [list, overview, tree, tags, purchases, locale] = await Promise.all([
    listProducts(ctx, {
      view,
      search: q,
      categoryId,
      tagIds: tagId ? [tagId] : undefined,
      priceMin,
      priceMax,
      purchaseRecordId,
      sort: sort?.key,
      dir: sort?.dir,
      page,
      pageSize: PAGE_SIZE,
    }),
    stockOverview(ctx),
    listCategoryTree(ctx),
    listTags(ctx),
    listPurchaseRecords(ctx, { pageSize: 200 }),
    requireTenantDisplay(ctx.tenantId),
  ]);
  const { currency, timeZone } = locale;

  const categories = flattenCategories(tree);
  const pathById = new Map(categories.map((c) => [c.id, c.path]));
  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.path }));
  const filtersActive = FILTER_PARAMS.some((p) => getParam(sp, p));

  const views = TAB_ORDER.map((v) => ({ value: v === DEFAULT_VIEW ? null : v, label: copy.views[v], count: list.counts[v] }));

  const bulkRows: Record<string, BulkRowMeta> = Object.fromEntries(
    list.rows.map((r) => [r.id, { stockCode: r.stockCode, title: r.title, price: r.price, status: r.status, activeBlocker: statusBlocker(r, "ACTIVE") }]),
  );

  const columns: Column<ProductListRow>[] = [
    {
      key: "title",
      header: copy.columns.product,
      sortKey: "title",
      cell: (r) => (
        <div className="flex min-w-[220px] items-center gap-2.5">
          <Thumb src={r.cover ? imageUrl(r.cover.storageKey, "thumb") : null} alt="" size="sm" />
          <div className="min-w-0">
            <Link
              href={`${BASE}/${r.id}`}
              className="line-clamp-2 font-medium text-ink after:absolute after:inset-0 after:content-[''] hover:underline"
            >
              {r.title}
            </Link>
            <div className="truncate text-xs text-muted">{r.category ? (pathById.get(r.category.id) ?? r.category.title) : copy.noCategory}</div>
          </div>
        </div>
      ),
    },
    {
      key: "stockCode",
      header: copy.columns.stockCode,
      sortKey: "stockCode",
      cell: (r) => <span className="font-mono tabular-nums">{r.stockCode}</span>,
    },
    {
      key: "status",
      header: copy.columns.status,
      cell: (r) =>
        r.reservedUntil ? (
          <ReservationCountdown
            until={r.reservedUntil.toISOString()}
            label={copy.inCart}
            expiresLabel={formatDate(r.reservedUntil, "time", timeZone)}
            fallback={<ProductStatusPill status={r.status} />}
          />
        ) : (
          <ProductStatusPill status={r.status} />
        ),
    },
    { key: "quantity", header: copy.columns.quantity, numeric: true, cell: (r) => <span className="font-mono">{r.quantity}</span> },
    {
      key: "purchasePrice",
      header: copy.columns.purchasePrice,
      numeric: true,
      hideBelow: "md",
      cell: (r) => <Money amount={r.purchasePrice} currency={currency} mono className="text-muted" />,
    },
    { key: "price", header: copy.columns.price, numeric: true, sortKey: "price", cell: (r) => <Money amount={r.price} currency={currency} mono /> },
    {
      key: "margin",
      header: copy.columns.margin,
      numeric: true,
      hideBelow: "lg",
      cell: (r) => <Money amount={r.margin} currency={currency} mono />,
    },
    {
      key: "publishedAt",
      header: copy.columns.published,
      sortKey: "publishedAt",
      hideBelow: "md",
      cell: (r) => <DateTime value={r.publishedAt} format="date" timeZone={timeZone} className="font-mono text-xs text-muted" />,
    },
  ];

  const newProduct = (
    <Link href={`${BASE}/new`} className={buttonClasses({ variant: "primary" })}>
      <span aria-hidden="true">+</span> {copy.newProduct}
    </Link>
  );

  const noProductsAtAll = list.counts.all === 0 && list.counts.archived === 0 && !filtersActive;

  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} actions={newProduct} />
      <div className="grid content-start gap-3 p-4 md:px-[22px] md:py-5">
        <section aria-label={copy.stats.label}>
          <ul className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px] text-muted">
            <li>
              <strong className="font-mono text-base font-semibold text-ink tabular-nums">{overview.forSale}</strong> {copy.stats.forSale}
            </li>
            <li>
              <strong className={`font-mono text-base font-semibold tabular-nums ${overview.reservedNow > 0 ? "text-warn" : "text-ink"}`}>
                {overview.reservedNow}
              </strong>{" "}
              {copy.stats.reserved}
            </li>
            <li>
              {copy.stats.value}{" "}
              <strong className="font-mono text-base font-semibold text-ink tabular-nums">{formatMoney(overview.valueAtPrice, currency)}</strong>{" "}
              {copy.stats.atPrice} <span aria-hidden="true">·</span>{" "}
              <strong className="font-mono font-medium text-ink tabular-nums">{formatMoney(overview.valueAtCost, currency)}</strong> {copy.stats.atCost}
              {overview.withoutPurchasePrice > 0 && <span className="text-xs"> ({copy.stats.withoutCost(overview.withoutPurchasePrice)})</span>}
            </li>
          </ul>
        </section>

        {noProductsAtAll ? (
          <div className="rounded-card border border-line bg-panel shadow-card">
            <EmptyState title={copy.empty.title} body={copy.empty.none} action={newProduct} />
          </div>
        ) : (
          <DataTable
            caption={copy.caption}
            columns={columns}
            rows={list.rows}
            rowKey={(r) => r.id}
            rowLabel={(r) => `#${r.stockCode} ${r.title}`}
            rowClassName={() => "relative [&>td:first-child]:relative [&>td:first-child]:z-[1]"}
            selectable
            sorting={{ sort: getParam(sp, "sort") ?? "-publishedAt", basePath: BASE, searchParams: sp }}
            empty={<EmptyState compact title={copy.empty.title} body={filtersActive ? copy.empty.filtered : copy.empty.view} />}
            toolbar={
              <>
                <ViewTabs basePath={BASE} searchParams={sp} active={view === DEFAULT_VIEW ? null : view} views={views} />
                <FilterBar end={<ClearFiltersLink params={FILTER_PARAMS} basePath={BASE} searchParams={sp} />}>
                  <SearchInput label={copy.search.label} placeholder={copy.search.placeholder} />
                  <FilterSelect
                    param="category"
                    label={copy.filters.category}
                    options={[{ value: "none", label: copy.filters.uncategorised }, ...categoryOptions]}
                  />
                  {tags.length > 0 && (
                    <FilterSelect param="tag" label={copy.filters.tag} options={tags.map((tg) => ({ value: tg.id, label: `${tg.name} (${tg.productCount})` }))} />
                  )}
                  {purchases.items.length > 0 && (
                    <FilterSelect
                      param="purchase"
                      label={copy.filters.purchase}
                      options={purchases.items.map((p) => ({
                        value: p.id,
                        label: [formatDate(p.purchasedAt, "date", "UTC"), p.supplier?.name, p.invoiceNumber].filter(Boolean).join(" · "),
                      }))}
                    />
                  )}
                  <PriceRangeFilter key={`${priceMin ?? ""}-${priceMax ?? ""}`} min={priceMin ?? null} max={priceMax ?? null} currency={currency} />
                  <FilterChip param="q" label={copy.filters.search} basePath={BASE} searchParams={sp} />
                  {priceMin !== undefined && (
                    <FilterChip param="pmin" label={copy.filters.priceMin} valueLabel={formatMoney(priceMin, currency)} basePath={BASE} searchParams={sp} />
                  )}
                  {priceMax !== undefined && (
                    <FilterChip param="pmax" label={copy.filters.priceMax} valueLabel={formatMoney(priceMax, currency)} basePath={BASE} searchParams={sp} />
                  )}
                </FilterBar>
                <BulkActions rows={bulkRows} categories={categoryOptions} currency={currency} />
              </>
            }
            footer={<Pagination page={page} pageSize={PAGE_SIZE} total={list.total} basePath={BASE} searchParams={sp} />}
          />
        )}
      </div>
    </>
  );
}
