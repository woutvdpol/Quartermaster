import Link from "next/link";
import Form from "next/form";
import { cn, formatMoney, currencyExponent } from "@/components/shop/ui";
import { catalogQueryString, categoryHref, type CatalogParams, type CatalogSort } from "@/server/storefront-catalog";
import type { CatalogFacets, FacetGroup, FacetValueOption, PublicCategoryNode } from "@/server/storefront-catalog/types";
import { HiddenParams } from "./HiddenParams";
import { catalogCopy as copy } from "./_copy";

type Props = {
  /** Distinguishes the desktop sidebar from the mobile sheet copy (unique ids). */
  idPrefix: string;
  basePath: string;
  shopPath: string;
  params: CatalogParams;
  defaultSort: CatalogSort;
  facets: CatalogFacets;
  /** null hides the category section (archive). */
  tree: PublicCategoryNode[] | null;
  currentCategoryId: string | null;
  /** Ids from root to the current category. */
  currentPath: string[];
  currency: string;
  priceFilter: boolean;
  /** Facet tokens fixed by the page (facet landing page); deselecting one leaves the landing page. */
  lockedFacets?: string[];
  /** Category page URL (default: the shop's /shop/category/{slug}; the sold archive has its own). */
  categoryLink?: (slug: string) => string;
};

/**
 * Sidebar facets: category tree (with live counts under the other filters), the shop's facet
 * filters (Period / Country / Branch / … — multi-select: OR within a facet, AND across facets;
 * hierarchical values), tags that are not mapped to a facet, and a price range.
 * Plain links and a GET form — works without JS.
 */
export function FacetPanel(props: Props) {
  const { idPrefix, basePath, params, defaultSort, facets, tree, currency, priceFilter } = props;
  const tags = facets.tags.map((t) => ({ ...t, label: t.name }));
  return (
    <div className="flex flex-col divide-y divide-shop-line *:py-6 *:first:pt-0 *:last:pb-0">
      {tree ? <CategorySection {...props} tree={tree} /> : null}

      {facets.facets.map((g) => (
        <FacetSection key={g.id} group={g} {...props} />
      ))}

      {tags.length ? (
        <section aria-labelledby={`${idPrefix}-tags`}>
          <h2 id={`${idPrefix}-tags`} className="mb-3 px-3 font-shop-body text-sm font-semibold tracking-normal text-shop-ink">
            {copy.filters.tags}
          </h2>
          <TagList tags={tags} params={params} basePath={basePath} defaultSort={defaultSort} />
        </section>
      ) : null}

      {priceFilter && (facets.price || params.min !== null || params.max !== null) ? (
        <section aria-labelledby={`${idPrefix}-price`}>
          <h2 id={`${idPrefix}-price`} className="mb-3 px-3 font-shop-body text-sm font-semibold tracking-normal text-shop-ink">
            {copy.filters.price}
          </h2>
          <Form action={basePath} scroll={false} className="flex flex-col gap-3">
            <HiddenParams params={params} keep={["q", "facets", "tags", "sort", "view"]} defaultSort={defaultSort} />
            <div className="grid grid-cols-2 gap-2">
              <PriceInput id={`${idPrefix}-min`} name="min" label={copy.filters.priceMin} value={params.min} placeholder={facets.price ? Math.floor(facets.price.min / 10 ** currencyExponent(currency)) : undefined} currency={currency} />
              <PriceInput id={`${idPrefix}-max`} name="max" label={copy.filters.priceMax} value={params.max} placeholder={facets.price ? Math.ceil(facets.price.max / 10 ** currencyExponent(currency)) : undefined} currency={currency} />
            </div>
            <button type="submit" className="h-10 rounded-shop-control border border-shop-line-strong bg-shop-surface text-sm font-semibold text-shop-ink transition-colors hover:border-shop-ink">
              {copy.filters.applyPrice}
            </button>
            {facets.price ? (
              <p className="text-xs text-shop-muted tabular-nums">
                {formatMoney(facets.price.min, currency)} – {formatMoney(facets.price.max, currency)}
              </p>
            ) : null}
          </Form>
        </section>
      ) : null}
    </div>
  );
}

function PriceInput({ id, name, label, value, placeholder, currency }: { id: string; name: string; label: string; value: number | null; placeholder?: number; currency: string }) {
  const symbol = formatMoney(0, currency).replace(/[\d.,\s]/g, "") || currency;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-shop-muted">
        {label}
      </label>
      <div className="flex h-10 items-center rounded-shop-control border border-shop-line-strong bg-shop-surface focus-within:border-shop-primary">
        <span className="pl-3.5 text-sm text-shop-muted" aria-hidden="true">
          {symbol}
        </span>
        <input
          id={id}
          name={name}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          defaultValue={value ?? undefined}
          placeholder={placeholder !== undefined ? String(placeholder) : undefined}
          className="h-full w-full min-w-0 bg-transparent pr-3 pl-1.5 text-sm tabular-nums text-shop-ink focus:outline-none"
        />
      </div>
    </div>
  );
}

const MAX_VISIBLE_TAGS = 8;
const MAX_VISIBLE_VALUES = 8;

/** Visible = has results, or is selected / has a selected descendant (so it can be deselected). */
function pruneValues(values: FacetValueOption[]): FacetValueOption[] {
  return values.flatMap((v) => {
    const children = pruneValues(v.children);
    return v.count > 0 || v.selected || children.length ? [{ ...v, children }] : [];
  });
}

const hasSelected = (v: FacetValueOption): boolean => v.selected || v.children.some(hasSelected);

function FacetSection({ group, idPrefix, basePath, shopPath, params, defaultSort, lockedFacets = [] }: Props & { group: FacetGroup }) {
  const values = pruneValues(group.values);
  if (!values.length) return null;
  const locked = new Set(lockedFacets);
  const hrefFor = (v: FacetValueOption) => {
    if (locked.has(v.token)) {
      // Leaving the landing page: keep the other locked tokens as normal filters.
      const rest = [...lockedFacets.filter((t) => t !== v.token), ...params.facets];
      return `${shopPath}${catalogQueryString(params, { facets: [...new Set(rest)] }, defaultSort)}`;
    }
    const next = v.selected ? params.facets.filter((t) => t !== v.token) : [...params.facets, v.token];
    return `${basePath}${catalogQueryString(params, { facets: next }, defaultSort)}`;
  };
  const render = (v: FacetValueOption) => (
    <li key={v.id}>
      <Link
        href={hrefFor(v)}
        scroll={false}
        rel="nofollow"
        aria-pressed={v.selected}
        className={cn(
          "flex items-center justify-between gap-3 rounded-shop-control px-3 py-1.5 text-sm transition-colors",
          v.selected ? "bg-shop-primary-soft font-medium text-shop-ink" : "text-shop-ink-2 hover:bg-shop-sunken hover:text-shop-ink",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn("grid size-4 shrink-0 place-items-center rounded-[0.3rem] border text-[10px] leading-none", v.selected ? "border-shop-primary bg-shop-primary text-shop-on-primary" : "border-shop-line-strong bg-shop-surface")}
          >
            {v.selected ? "✓" : ""}
          </span>
          <span className="truncate">{v.name}</span>
        </span>
        <span className="text-xs text-shop-muted tabular-nums">{v.count}</span>
      </Link>
      {v.children.length ? <ul className="mt-0.5 ml-4 flex flex-col gap-0.5 border-l border-shop-line pl-2">{v.children.map(render)}</ul> : null}
    </li>
  );
  const visible = values.slice(0, MAX_VISIBLE_VALUES);
  const rest = values.slice(MAX_VISIBLE_VALUES);
  const headingId = `${idPrefix}-fc-${group.slug}`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-3 px-3 font-shop-body text-sm font-semibold tracking-normal text-shop-ink">
        {group.name}
      </h2>
      <ul className="flex flex-col gap-0.5">{visible.map(render)}</ul>
      {rest.length ? (
        <details open={rest.some(hasSelected)} className="mt-1">
          <summary className="cursor-pointer px-3 py-1.5 text-sm font-medium text-shop-ink-2 underline decoration-shop-line-strong underline-offset-4 hover:text-shop-ink">{copy.filters.showMore}</summary>
          <ul className="mt-1 flex flex-col gap-0.5">{rest.map(render)}</ul>
        </details>
      ) : null}
    </section>
  );
}

function TagList({ tags, params, basePath, defaultSort }: { tags: { slug: string; label: string; count: number }[]; params: CatalogParams; basePath: string; defaultSort: CatalogSort }) {
  const selected = new Set(params.tags);
  const render = (t: (typeof tags)[number]) => {
    const on = selected.has(t.slug);
    const next = on ? params.tags.filter((s) => s !== t.slug) : [...params.tags, t.slug];
    return (
      <li key={t.slug}>
        <Link
          href={`${basePath}${catalogQueryString(params, { tags: next }, defaultSort)}`}
          scroll={false}
          rel="nofollow"
          aria-pressed={on}
          className={cn(
            "flex items-center justify-between gap-3 rounded-shop-control px-3 py-1.5 text-sm transition-colors",
            on ? "bg-shop-primary-soft font-medium text-shop-ink" : "text-shop-ink-2 hover:bg-shop-sunken hover:text-shop-ink",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className={cn("grid size-4 shrink-0 place-items-center rounded-[0.3rem] border text-[10px] leading-none", on ? "border-shop-primary bg-shop-primary text-shop-on-primary" : "border-shop-line-strong bg-shop-surface")}
            >
              {on ? "✓" : ""}
            </span>
            <span className="truncate">{t.label}</span>
          </span>
          <span className="text-xs text-shop-muted tabular-nums">{t.count}</span>
        </Link>
      </li>
    );
  };
  const visible = tags.slice(0, MAX_VISIBLE_TAGS);
  const rest = tags.slice(MAX_VISIBLE_TAGS);
  const restHasSelected = rest.some((t) => selected.has(t.slug));
  return (
    <>
      <ul className="flex flex-col gap-0.5">{visible.map(render)}</ul>
      {rest.length ? (
        <details open={restHasSelected} className="mt-1">
          <summary className="cursor-pointer px-3 py-1.5 text-sm font-medium text-shop-ink-2 underline decoration-shop-line-strong underline-offset-4 hover:text-shop-ink">{copy.filters.showMore}</summary>
          <ul className="mt-1 flex flex-col gap-0.5">{rest.map(render)}</ul>
        </details>
      ) : null}
    </>
  );
}

function CategorySection({ idPrefix, shopPath, params, defaultSort, facets, tree, currentCategoryId, currentPath, categoryLink = categoryHref }: Props & { tree: PublicCategoryNode[] }) {
  const counts = facets.categoryCounts;
  const totalOf = (n: PublicCategoryNode): number => (counts[n.id] ?? 0) + n.children.reduce((s, c) => s + totalOf(c), 0);
  const onPath = new Set(currentPath);
  // Keep q/tags/price/sort/view when switching categories; reset paging.
  const qs = catalogQueryString(params, { page: 1, show: null }, defaultSort);
  const allTotal = Object.values(counts).reduce((a, b) => a + b, 0);

  const renderNodes = (nodes: PublicCategoryNode[], depth: number) => (
    <ul className={cn("flex flex-col gap-0.5", depth > 0 && "mt-0.5 ml-4 border-l border-shop-line pl-2")}>
      {nodes.map((n) => {
        const total = totalOf(n);
        const current = n.id === currentCategoryId;
        if (total === 0 && !onPath.has(n.id)) return null;
        const expanded = onPath.has(n.id) && n.children.length > 0;
        return (
          <li key={n.id}>
            <Link
              href={`${categoryLink(n.slug)}${qs}`}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex items-center justify-between gap-3 rounded-shop-control px-3 py-1.5 text-sm transition-colors",
                current ? "bg-shop-sunken font-semibold text-shop-ink" : onPath.has(n.id) ? "font-medium text-shop-ink hover:bg-shop-sunken" : "text-shop-ink-2 hover:bg-shop-sunken hover:text-shop-ink",
              )}
            >
              <span className="truncate">{n.title}</span>
              <span className="text-xs text-shop-muted tabular-nums">{total}</span>
            </Link>
            {expanded ? renderNodes(n.children, depth + 1) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav aria-labelledby={`${idPrefix}-cats`}>
      <h2 id={`${idPrefix}-cats`} className="mb-3 px-3 font-shop-body text-sm font-semibold tracking-normal text-shop-ink">
        {copy.filters.categories}
      </h2>
      <Link
        href={`${shopPath}${qs}`}
        aria-current={currentCategoryId === null ? "page" : undefined}
        className={cn(
          "mb-0.5 flex items-center justify-between gap-3 rounded-shop-control px-3 py-1.5 text-sm transition-colors",
          currentCategoryId === null ? "bg-shop-sunken font-semibold text-shop-ink" : "text-shop-ink-2 hover:bg-shop-sunken hover:text-shop-ink",
        )}
      >
        <span>{copy.filters.allCategories}</span>
        <span className="text-xs text-shop-muted tabular-nums">{allTotal}</span>
      </Link>
      {renderNodes(tree, 0)}
    </nav>
  );
}
