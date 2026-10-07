import Link from "next/link";
import type { ReactNode } from "react";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { hrefWith, type SearchParamsInput } from "./url";

const t = getDictionary().ui.table;

export type SortConfig = {
  /** Current sort value from the URL, e.g. "price" or "-price". */
  sort: string | null | undefined;
  basePath: string;
  searchParams: SearchParamsInput;
  /** URL parameter (default "sort"). */
  param?: string;
};

/** `aria-sort` value for a column header. */
export function ariaSort(sort: string | null | undefined, key: string): "ascending" | "descending" | undefined {
  if (sort === key) return "ascending";
  if (sort === `-${key}`) return "descending";
  return undefined;
}

/**
 * Sortable column header content (put it inside <th aria-sort={ariaSort(sort, key)}>; DataTable does
 * this for columns with `sortKey`). Click toggles ascending → descending; resets the page.
 */
export function SortLink({
  label,
  sortKey,
  sort,
  basePath,
  searchParams,
  param = "sort",
  align = "left",
  defaultDirection = "asc",
}: SortConfig & { label: ReactNode; sortKey: string; align?: "left" | "right" | "center"; defaultDirection?: "asc" | "desc" }) {
  const state = ariaSort(sort, sortKey);
  const nextValue =
    state === "ascending" ? `-${sortKey}` : state === "descending" ? sortKey : defaultDirection === "desc" ? `-${sortKey}` : sortKey;
  const href = hrefWith(basePath, searchParams, { [param]: nextValue, page: null });
  return (
    <Link
      href={href}
      scroll={false}
      replace
      className={cx(
        "inline-flex items-center gap-1 rounded-[3px] hover:text-ink",
        align === "right" && "flex-row-reverse",
        state && "text-ink",
      )}
    >
      <span>{label}</span>
      <span aria-hidden="true" className={cx("text-[9px]", !state && "opacity-40")}>
        {state === "ascending" ? "▲" : state === "descending" ? "▼" : "▲▼"}
      </span>
      {state && <span className="sr-only">, {state === "ascending" ? t.sortAscending : t.sortDescending}</span>}
    </Link>
  );
}
