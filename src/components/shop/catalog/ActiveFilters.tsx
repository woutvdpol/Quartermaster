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
  currency,
  category,
  shopPath,
}: {
  basePath: string;
  params: CatalogParams;
  defaultSort: CatalogSort;
  tagNames: Record<string, string>;
  currency: string;
  /** The current category (a chip that goes back to the unscoped list). */
  category?: { title: string } | null;
  shopPath: string;
}) {
  const chips: { key: string; label: string; href: string }[] = [];
  const qs = (patch: Partial<CatalogParams>) => catalogQueryString(params, patch, defaultSort);
  if (category) chips.push({ key: "cat", label: category.title, href: `${shopPath}${qs({ page: 1, show: null })}` });
  if (params.q) chips.push({ key: "q", label: copy.filters.search(params.q), href: `${basePath}${qs({ q: null })}` });
  for (const t of params.tags) {
    chips.push({ key: `t:${t}`, label: tagNames[t] ?? t, href: `${basePath}${qs({ tags: params.tags.filter((x) => x !== t) })}` });
  }
  if (params.min !== null || params.max !== null) {
    const fmt = (n: number | null) => (n === null ? null : formatMoney(n * 10 ** currencyExponent(currency), currency).replace(/[.,]00$/, ""));
    chips.push({ key: "price", label: copy.filters.priceRange(fmt(params.min), fmt(params.max)), href: `${basePath}${qs({ min: null, max: null })}` });
  }
  if (!chips.length) return null;
  const clear = `${category ? shopPath : basePath}${catalogQueryString({ ...params, q: null, tags: [], min: null, max: null }, { page: 1, show: null }, defaultSort)}`;
  return (
    <div className="flex flex-wrap items-center gap-2" role="region" aria-label={copy.filters.active}>
      {chips.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          scroll={false}
          rel="nofollow"
          aria-label={copy.filters.remove(c.label)}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-shop-line-strong bg-shop-surface pr-2 pl-3 text-sm text-shop-ink hover:border-shop-ink"
        >
          <span className="max-w-[16rem] truncate">{c.label}</span>
          <span aria-hidden="true" className="text-shop-muted">
            ×
          </span>
        </Link>
      ))}
      {chips.length > 1 ? (
        <Link href={clear} scroll={false} className="px-1 text-sm font-medium text-shop-primary underline-offset-4 hover:underline">
          {copy.filters.clearAll}
        </Link>
      ) : null}
    </div>
  );
}
