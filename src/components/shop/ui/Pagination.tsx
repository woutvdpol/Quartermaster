import Link from "next/link";
import { cn } from "./cn";
import { uiCopy } from "./_copy";

/**
 * Page links. `hrefFor(page)` builds each URL (keep the other search params there).
 * Shows first, last, current ±1 and ellipses. Renders nothing for a single page.
 */
export function Pagination({
  page,
  pageCount,
  hrefFor,
  className,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  const pages = pageWindow(page, pageCount);
  const item = "inline-flex h-10 min-w-10 items-center justify-center rounded-shop-sm px-3 text-sm tabular-nums";
  return (
    <nav aria-label={uiCopy.pagination.label} className={cn("flex justify-center", className)}>
      <ul className="flex flex-wrap items-center gap-1">
        <li>
          {page > 1 ? (
            <Link href={hrefFor(page - 1)} rel="prev" className={cn(item, "hover:bg-shop-sunken")}>
              <span aria-hidden="true">←</span> <span className="ml-1 hidden sm:inline">{uiCopy.pagination.previous}</span>
              <span className="sr-only sm:hidden">{uiCopy.pagination.previous}</span>
            </Link>
          ) : null}
        </li>
        {pages.map((p, i) =>
          p === null ? (
            <li key={`gap-${i}`} aria-hidden="true" className="px-1 text-shop-muted">
              …
            </li>
          ) : (
            <li key={p}>
              {p === page ? (
                <span aria-current="page" className={cn(item, "bg-shop-primary font-semibold text-shop-on-primary")}>
                  <span className="sr-only">{uiCopy.pagination.page} </span>
                  {p}
                </span>
              ) : (
                <Link href={hrefFor(p)} className={cn(item, "text-shop-ink-2 hover:bg-shop-sunken")}>
                  <span className="sr-only">{uiCopy.pagination.page} </span>
                  {p}
                </Link>
              )}
            </li>
          ),
        )}
        <li>
          {page < pageCount ? (
            <Link href={hrefFor(page + 1)} rel="next" className={cn(item, "hover:bg-shop-sunken")}>
              <span className="mr-1 hidden sm:inline">{uiCopy.pagination.next}</span>
              <span className="sr-only sm:hidden">{uiCopy.pagination.next}</span> <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </li>
      </ul>
    </nav>
  );
}

/** Page numbers to show; null = ellipsis. Exported for tests. */
export function pageWindow(page: number, pageCount: number): Array<number | null> {
  const set = new Set<number>([1, pageCount, page - 1, page, page + 1]);
  const sorted = [...set].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out: Array<number | null> = [];
  for (const [i, p] of sorted.entries()) {
    if (i > 0) {
      const prev = sorted[i - 1];
      if (p - prev === 2) out.push(prev + 1);
      else if (p - prev > 2) out.push(null);
    }
    out.push(p);
  }
  return out;
}
