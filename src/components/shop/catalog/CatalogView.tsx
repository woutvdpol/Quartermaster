import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { permanentRedirect } from "next/navigation";
import { complianceHideFilter, resolveCompliance, visitorCountry } from "@/server/compliance";
import { Breadcrumbs, ButtonLink, Container, EmptyState, Pagination, ProductGrid, currencyExponent, type Crumb } from "@/components/shop/ui";
import { WishlistButton } from "@/components/shop/account/WishlistButton";
import { SaveSearchButton } from "@/components/shop/alerts";
import { getVisitorDisplayCurrency } from "@/server/rates/display";
import type { ShopContext } from "@/server/storefront/context";
import { getShopViewer } from "@/server/storefront/viewer";
import {
  PAGE_SIZE,
  MAX_SHOW,
  SHOP_PATH,
  catalogQueryString,
  flattenTree,
  getCatalogPage,
  getCategoryTree,
  getFacets,
  getTagsBySlug,
  getTaxonomy,
  facetToken,
  tokensForValueIds,
  hasActiveFilters,
  liveReservedIds,
  parseCatalogParams,
  selectedFacetValueIds,
  sortFromSetting,
  subtreeIds,
  withLiveStatus,
  categoryPath,
  type CatalogMode,
  type CatalogSort,
  type ListScope,
  type RawSearchParams,
} from "@/server/storefront-catalog";
import type { FacetValueOption, PublicCategory } from "@/server/storefront-catalog/types";
import { ActiveFilters } from "./ActiveFilters";
import { CatalogList } from "./CatalogList";
import { FacetPanel } from "./FacetPanel";
import { HiddenParams } from "./HiddenParams";
import { MobileFilters } from "./MobileFilters";
import { SearchBox } from "./SearchBox";
import { SortSelect } from "./SortSelect";
import { ViewToggle } from "./ViewToggle";
import { applyGeoBlur, toCardData } from "./to-card";
import { catalogCopy as copy } from "./_copy";

export type CatalogViewProps = {
  shop: ShopContext;
  mode: CatalogMode;
  /** Path the filters/paging links point at ("/shop", "/shop/category/x", "/archive"). */
  basePath: string;
  category?: PublicCategory | null;
  searchParams: RawSearchParams;
  title: string;
  intro?: ReactNode;
  crumbs: Crumb[];
  /** Facet tokens fixed by the page (SEO landing /shop/facet/{facet}/{value}). */
  lockedFacets?: string[];
};

/** Default sort for a mode (archive: most recently sold first). */
export function defaultSortFor(shop: ShopContext, mode: CatalogMode): CatalogSort {
  return mode === "archive" ? "newest" : sortFromSetting(shop.settings.catalog.defaultSort);
}

/**
 * The shop catalog (also used for category pages and the sold archive): facet sidebar (desktop) /
 * bottom sheet (mobile), search, sort, active filter chips, result count, grid or list, pagination or
 * "load more". All state lives in the URL; everything works without JS.
 */
export async function CatalogView({ shop, mode, basePath, category, searchParams, title, intro, crumbs, lockedFacets = [] }: CatalogViewProps) {
  const tenantId = shop.tenant.id;
  const currency = shop.tenant.currency;
  const settings = shop.settings.catalog;
  const defaultSort = defaultSortFor(shop, mode);
  const params = parseCatalogParams(searchParams, defaultSort);

  // Visitor country (edge geo header) → per-country compliance rules; unknown country = no geo rules.
  const country = visitorCountry(await headers());
  const [tree, hide] = await Promise.all([mode === "shop" ? getCategoryTree(tenantId) : Promise.resolve(null), complianceHideFilter(tenantId, country)]);
  const node = category && tree ? (flattenTree(tree).find((n) => n.id === category.id) ?? null) : null;
  const scope: ListScope = {
    mode,
    categoryIds: category ? (node ? subtreeIds(node) : [category.id]) : null,
    priceUnit: 10 ** currencyExponent(currency),
    hide,
    lockedFacets,
  };

  const [page, facets, selectedTags, viewer, display] = await Promise.all([
    getCatalogPage(tenantId, scope, params),
    getFacets(tenantId, scope, params),
    getTagsBySlug(tenantId, params.tags),
    getShopViewer(tenantId),
    // Visitor's indicative display currency (cookie) — read here, outside the cached catalog reads.
    getVisitorDisplayCurrency(tenantId),
  ]);
  // Canonical facet URLs: f=<valueId> (saved-search links) → f=<facet>.<value>; old tag links
  // (?tag=ww2) whose tag was converted to a facet value → the facet filter.
  const unknownTags = params.tags.filter((t) => !selectedTags.some((st) => st.slug === t));
  if (unknownTags.length || params.facetValueIds.length) {
    const tax = await getTaxonomy(tenantId);
    const mapped = unknownTags.flatMap((slug) => {
      const value = tax.values.find((v) => v.slug === slug);
      const facet = value ? tax.facets.find((f) => f.id === value.facetId) : undefined;
      return value && facet ? [{ slug, token: facetToken(facet.slug, value.slug) }] : [];
    });
    if (mapped.length || params.facetValueIds.length) {
      const tags = params.tags.filter((t) => !mapped.some((m) => m.slug === t));
      const facetsNext = [...new Set([...params.facets, ...tokensForValueIds(tax, params.facetValueIds), ...mapped.map((m) => m.token)])];
      permanentRedirect(`${basePath}${catalogQueryString(params, { tags, facets: facetsNext, facetValueIds: [] }, defaultSort)}`);
    }
  }
  const ids = page.items.map((i) => i.id);
  const [reserved, verdicts, saveFacetValueIds] = await Promise.all([
    mode === "shop" ? liveReservedIds(tenantId, ids) : Promise.resolve(new Set<string>()),
    country ? resolveCompliance(tenantId, ids, country) : Promise.resolve({} as Awaited<ReturnType<typeof resolveCompliance>>),
    mode === "shop" ? selectedFacetValueIds(tenantId, params, lockedFacets) : Promise.resolve([] as string[]),
  ]);
  // "Save this search" (alerts): the current filters as a stored query.
  const saveQuery = {
    q: params.q || null,
    categoryId: category?.id ?? null,
    tags: params.tags,
    facetValueIds: saveFacetValueIds,
    min: params.min,
    max: params.max,
  };
  const cardCtx = {
    currency,
    showPriceWhenSold: settings.showPriceWhenSold,
    lockSensitive: shop.settings.legal.blurSensitiveForGuests && !viewer,
  };
  const cards = withLiveStatus(page.items, reserved).map((c) => applyGeoBlur(toCardData(c, cardCtx), c, verdicts[c.id]?.blurred ?? false));

  const view = params.view ?? settings.layout;
  const filtered = hasActiveFilters(params);
  const tagNames = Object.fromEntries([...facets.tags, ...selectedTags].map((t) => [t.slug, t.name]));
  const facetNames: Record<string, string> = {};
  const collect = (v: FacetValueOption) => {
    facetNames[v.token] = v.name;
    v.children.forEach(collect);
  };
  facets.facets.forEach((g) => g.values.forEach(collect));
  const pageCount = Math.max(1, Math.ceil(page.total / PAGE_SIZE));
  const currentPath = category && tree ? categoryPath(tree, category.id).map((n) => n.id) : [];
  const activeCount = params.facets.length + params.tags.length + (params.q ? 1 : 0) + (params.min !== null || params.max !== null ? 1 : 0);

  const sortOptions = (
    mode === "archive"
      ? (["newest", "price_desc", "price_asc"] as const).map((v) => ({ value: v, label: v === "newest" ? copy.toolbar.archiveNewest : copy.toolbar.sorts[v] }))
      : (["newest", "oldest", "price_asc", "price_desc", "updated", ...(defaultSort === "featured" ? (["featured"] as const) : [])] as const).map((v) => ({
          value: v,
          label: copy.toolbar.sorts[v],
        }))
  ).sort((a, b) => (a.value === defaultSort ? -1 : b.value === defaultSort ? 1 : 0));

  const facetProps = {
    basePath,
    shopPath: SHOP_PATH,
    params,
    defaultSort,
    facets,
    tree,
    currentCategoryId: category?.id ?? null,
    currentPath,
    currency,
    priceFilter: settings.priceFilter,
    lockedFacets,
  };

  const shown = params.show ? Math.min(params.show, page.total) : null;
  const nextShow = Math.min(MAX_SHOW, (params.show ?? PAGE_SIZE) + PAGE_SIZE);

  return (
    <Container className="py-6 sm:py-10">
      <Breadcrumbs items={crumbs} jsonLdBase={shop.origin} />

      <header className="mt-4 mb-6 sm:mb-8">
        <h1 className="text-3xl text-shop-ink sm:text-4xl">{title}</h1>
        {intro ? <div className="mt-3 text-shop-muted">{intro}</div> : null}
      </header>

      <div className="grid gap-8 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-10">
        <aside className="hidden lg:block" aria-label={copy.filters.heading}>
          <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-1 pb-6">
            <FacetPanel idPrefix="fd" {...facetProps} />
          </div>
        </aside>

        <div className="min-w-0">
          <div className="mb-4">
            <SearchBox action={basePath} params={params} defaultSort={defaultSort} />
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-shop-line pb-3">
            <div className="flex items-center gap-3">
              <MobileFilters activeCount={activeCount} total={page.total}>
                <FacetPanel idPrefix="fm" {...facetProps} />
              </MobileFilters>
              <p className="text-sm text-shop-muted tabular-nums" aria-live="polite">
                {copy.toolbar.results(page.total)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {mode === "shop" ? <SaveSearchButton query={saveQuery} /> : null}
              <SortSelect action={basePath} value={params.sort} options={sortOptions}>
                <HiddenParams params={params} keep={["q", "facets", "tags", "min", "max", "view"]} defaultSort={defaultSort} />
              </SortSelect>
              <ViewToggle basePath={basePath} params={params} view={view} defaultSort={defaultSort} />
            </div>
          </div>

          <div className="mb-6 empty:hidden">
            <ActiveFilters
              basePath={basePath}
              shopPath={SHOP_PATH}
              params={params}
              defaultSort={defaultSort}
              tagNames={tagNames}
              facetNames={facetNames}
              lockedFacets={lockedFacets}
              currency={currency}
              category={category && filtered ? category : null}
            />
          </div>

          {cards.length === 0 ? (
            <EmptyState
              title={copy.empty.title}
              action={
                filtered || params.page > 1 ? (
                  <ButtonLink href={basePath} variant="outline">
                    {copy.filters.clearAll}
                  </ButtonLink>
                ) : mode === "archive" || category ? (
                  <ButtonLink href={SHOP_PATH} variant="outline">
                    {copy.empty.back}
                  </ButtonLink>
                ) : null
              }
            >
              {filtered ? copy.empty.filtered : mode === "archive" ? copy.empty.archiveNone : copy.empty.none}
            </EmptyState>
          ) : view === "list" ? (
            <CatalogList products={cards} showStockCode={settings.showStockCode} display={display} />
          ) : (
            <ProductGrid
              products={cards}
              columns={settings.gridColumns === 3 ? 3 : 4}
              showStockCode={settings.showStockCode}
              display={display}
              priorityCount={4}
              headingLevel={2}
              wishlistSlot={mode === "shop" ? (p) => (p.availability === "sold" ? null : <WishlistButton productId={p.id} />) : undefined}
            />
          )}

          {cards.length > 0 ? (
            settings.endlessScroll ? (
              <div className="mt-10 flex flex-col items-center gap-3">
                <p className="text-sm text-shop-muted tabular-nums">{copy.showing(shown ?? Math.min(PAGE_SIZE, page.total), page.total)}</p>
                {(shown ?? PAGE_SIZE) < page.total && nextShow > (params.show ?? PAGE_SIZE) ? (
                  <Link
                    href={`${basePath}${catalogQueryString(params, { show: nextShow, page: 1 }, defaultSort)}`}
                    scroll={false}
                    className="inline-flex h-11 items-center rounded-shop-sm border border-shop-line-strong bg-shop-surface px-6 text-sm font-medium text-shop-ink hover:border-shop-ink"
                  >
                    {copy.loadMore}
                  </Link>
                ) : null}
              </div>
            ) : (
              <Pagination
                className="mt-10"
                page={params.page}
                pageCount={pageCount}
                hrefFor={(p) => `${basePath}${catalogQueryString(params, { page: p, show: null }, defaultSort)}`}
              />
            )
          ) : null}
        </div>
      </div>
    </Container>
  );
}
