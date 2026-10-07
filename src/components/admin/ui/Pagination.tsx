import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { hrefWith, type SearchParamsInput } from "./url";

const t = getDictionary().ui.pagination;

type PaginationProps = {
  /** 1-based current page (use parsePage(searchParams.page)). */
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  searchParams: SearchParamsInput;
  param?: string;
  className?: string;
};

/** Page window with ellipses: 1 … 4 5 [6] 7 8 … 20 */
function pageWindow(page: number, pages: number): Array<number | "gap"> {
  const out: Array<number | "gap"> = [];
  const from = Math.max(2, page - 2);
  const to = Math.min(pages - 1, page + 2);
  out.push(1);
  if (from > 2) out.push("gap");
  for (let p = from; p <= to; p++) out.push(p);
  if (to < pages - 1) out.push("gap");
  if (pages > 1) out.push(pages);
  return out;
}

const itemClass =
  "inline-flex h-7 min-w-7 items-center justify-center rounded-control border px-2 text-xs tabular-nums transition-colors";

/** URL-based pagination (keeps all other search params). Server-component friendly. */
export function Pagination({ page, pageSize, total, basePath, searchParams, param = "page", className }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);
  const href = (p: number) => hrefWith(basePath, searchParams, { [param]: p === 1 ? null : p });

  return (
    <div className={cx("flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-xs text-muted", className)}>
      <p className="tabular-nums">{total === 0 ? t.none : t.range(from, to, total)}</p>
      {pages > 1 && (
        <nav aria-label={t.label}>
          <ul className="flex flex-wrap items-center gap-1">
            <li>
              {current > 1 ? (
                <Link href={href(current - 1)} rel="prev" className={cx(itemClass, "border-line bg-panel text-ink hover:bg-panel-2")}>
                  <span aria-hidden="true">‹</span>&nbsp;{t.previous}
                </Link>
              ) : (
                <span aria-disabled="true" className={cx(itemClass, "border-line text-muted opacity-60")}>
                  <span aria-hidden="true">‹</span>&nbsp;{t.previous}
                </span>
              )}
            </li>
            {pageWindow(current, pages).map((p, i) =>
              p === "gap" ? (
                <li key={`gap${i}`} aria-hidden="true" className="px-1">
                  …
                </li>
              ) : (
                <li key={p} className="max-sm:hidden">
                  <Link
                    href={href(p)}
                    aria-label={t.page(p)}
                    aria-current={p === current ? "page" : undefined}
                    className={cx(
                      itemClass,
                      p === current
                        ? "border-accent bg-accent font-semibold text-on-accent"
                        : "border-transparent text-ink hover:border-line hover:bg-panel-2",
                    )}
                  >
                    {p}
                  </Link>
                </li>
              ),
            )}
            <li>
              {current < pages ? (
                <Link href={href(current + 1)} rel="next" className={cx(itemClass, "border-line bg-panel text-ink hover:bg-panel-2")}>
                  {t.next}&nbsp;<span aria-hidden="true">›</span>
                </Link>
              ) : (
                <span aria-disabled="true" className={cx(itemClass, "border-line text-muted opacity-60")}>
                  {t.next}&nbsp;<span aria-hidden="true">›</span>
                </span>
              )}
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}
