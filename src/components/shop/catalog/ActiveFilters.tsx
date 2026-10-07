import Link from "next/link";
import { currencyExponent, formatMoney } from "@/components/shop/ui";
import { catalogQueryString, type CatalogParams, type CatalogSort } from "@/server/storefront-catalog";
import { catalogCopy as copy } from "./_copy";

/** Removable chips for every active filter + "Clear all". Renders nothing without filters. */
export function ActiveFilters({
  basePath,
  params,
  defaultSort,
  tagNames,
  facetNames = {},
  lockedFacets = [],
  currency,
  category,
  shopPath,
}: {
  basePath: string;
  params: CatalogParams;
  defaultSort: CatalogSort;
  tagNames: Record<string, string>;
  /** Facet token → value name. */
  facetNames?: Record<string, string>;
  /** Facet tokens fixed by the page (landing page): their chip leaves the page. */
  lockedFacets?: string[];
  currency: string;
  /** The current category (a chip that goes back to the unscoped list). */
  category?: { title: string } | null;
  shopPath: string;
}) {
  const chips: { key: string; label: string; href: string }[] = [];
  const qs = (patch: Partial<CatalogParams>) => catalogQueryString(params, patch, defaultSort);
  if (category) chips.push({ key: "cat", label: category.title, href: `${shopPath}${qs({ page: 1, show: null })}` });
  for (const t of lockedFacets) {
    const rest = [...new Set([...lockedFacets.filter((x) => x !== t), ...params.facets])];
    chips.push({ key: `lf:${t}`, label: facetNames[t] ?? t, href: `${shopPath}${qs({ facets: rest })}` });
  }
  if (params.q) chips.push({ key: "q", label: copy.filters.search(params.q), href: `${basePath}${qs({ q: null })}` });
  for (const t of params.facets) {
    if (lockedFacets.includes(t)) continue;
    chips.push({ key: `f:${t}`, label: facetNames[t] ?? t, href: `${basePath}${qs({ facets: params.facets.filter((x) => x !== t) })}` });
  }
  for (const t of params.tags) {
    chips.push({ key: `t:${t}`, label: tagNames[t] ?? t, href: `${basePath}${qs({ tags: params.tags.filter((x) => x !== t) })}` });
  }
  if (params.min !== null || params.max !== null) {
    const fmt = (n: number | null) => (n === null ? null : formatMoney(n * 10 ** currencyExponent(currency), currency).replace(/[.,]00$/, ""));
    chips.push({ key: "price", label: copy.filters.priceRange(fmt(params.min), fmt(params.max)), href: `${basePath}${qs({ min: null, max: null })}` });
  }
  if (!chips.length) return null;
  const clear = `${category || lockedFacets.length ? shopPath : basePath}${catalogQueryString({ ...params, q: null, facets: [], tags: [], min: null, max: null }, { page: 1, show: null }, defaultSort)}`;
  return (
    <div className="flex flex-wrap items-center gap-2" role="region" aria-label={copy.filters.active}>
      {chips.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          scroll={false}
          rel="nofollow"
          aria-label={copy.filters.remove(c.label)}
          className="group inline-flex h-8 items-center gap-1.5 rounded-shop-control bg-shop-sunken pr-1.5 pl-3.5 text-sm font-medium text-shop-ink transition-colors hover:bg-shop-line"
        >
          <span className="max-w-[16rem] truncate">{c.label}</span>
          <span aria-hidden="true" className="grid size-5 place-items-center rounded-shop-control text-shop-muted group-hover:bg-shop-surface group-hover:text-shop-ink">
            <svg viewBox="0 0 20 20" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" strokeLinecap="round" />
            </svg>
          </span>
        </Link>
      ))}
      {chips.length > 1 ? (
        <Link href={clear} scroll={false} className="px-2 text-sm font-medium text-shop-ink-2 underline decoration-shop-line-strong underline-offset-4 hover:text-shop-ink hover:decoration-shop-ink">
          {copy.filters.clearAll}
        </Link>
      ) : null}
    </div>
  );
}
