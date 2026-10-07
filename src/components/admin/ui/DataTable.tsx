import type { ReactNode } from "react";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { EmptyState } from "./EmptyState";
import { BulkActionBar, RowCheckbox, SelectAllCheckbox, SelectionProvider } from "./selection";
import { Skeleton } from "./Skeleton";
import { ariaSort, SortLink, type SortConfig } from "./SortLink";
import { tdClass, thClass } from "./styles";

const t = getDictionary().ui.table;

export type Column<T> = {
  /** Unique key (also the React key of the cells). */
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  /** Right-aligned, tabular figures (prices, quantities, dates as numbers). */
  numeric?: boolean;
  align?: "left" | "right" | "center";
  /** CSS width, e.g. "120px" or "20%". */
  width?: string;
  /** Makes the header a SortLink (requires DataTable `sorting`). */
  sortKey?: string;
  /** Hide below a breakpoint on small screens. */
  hideBelow?: "sm" | "md" | "lg";
  className?: string;
  headerClassName?: string;
};

export type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible table name (rendered as a visually hidden caption). */
  caption: string;
  /** Adds row checkboxes, a select-all header and the bulk bar. */
  selectable?: boolean;
  /** Text for each row's checkbox label ("Select <label>"). Defaults to the row key. */
  rowLabel?: (row: T) => string;
  /** Content of the dark bulk bar shown while rows are selected (see BulkActionBar). */
  bulkActions?: ReactNode;
  /** Default form action for the bulk buttons; receives formData.getAll("ids"). */
  bulkAction?: (formData: FormData) => void | Promise<void>;
  /** URL-based sorting for columns with `sortKey`. */
  sorting?: SortConfig;
  /** Shown instead of the body when rows is empty. */
  empty?: ReactNode;
  /** Header sticks while the table body scrolls. Set `maxHeight` to scroll inside the table. */
  stickyHeader?: boolean;
  maxHeight?: string;
  rowClassName?: (row: T) => string | undefined;
  /** Toolbar rows above the table (ViewTabs, FilterBar …) inside the same card. */
  toolbar?: ReactNode;
  /** Footer below the table (Pagination). */
  footer?: ReactNode;
  className?: string;
};

const hideClass = { sm: "max-sm:hidden", md: "max-md:hidden", lg: "max-lg:hidden" };

function alignClass(col: { numeric?: boolean; align?: "left" | "right" | "center" }) {
  const align = col.align ?? (col.numeric ? "right" : "left");
  return align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
}

/**
 * Server-rendered admin table (design A): uppercase condensed headers, tabular numbers, optional
 * row selection with bulk bar, URL sorting, sticky header and empty state. Works in server and
 * client components (cell renderers run where the table renders).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  selectable = false,
  rowLabel,
  bulkActions,
  bulkAction,
  sorting,
  empty,
  stickyHeader = true,
  maxHeight,
  rowClassName,
  toolbar,
  footer,
  className,
}: DataTableProps<T>) {
  const ids = rows.map(rowKey);
  const colCount = columns.length + (selectable ? 1 : 0);
  const stickyTh = stickyHeader ? "sticky top-0 z-[1] bg-panel" : "";

  const table = (
    <div
      className={cx("overflow-x-auto", maxHeight && "overflow-y-auto")}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {selectable && <col style={{ width: "36px" }} />}
          {columns.map((col) => (
            <col key={col.key} style={col.width ? { width: col.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className={cx(thClass, stickyTh, "border-b border-line pr-0")}>
                <SelectAllCheckbox />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                aria-sort={col.sortKey && sorting ? ariaSort(sorting.sort, col.sortKey) : undefined}
                className={cx(
                  thClass,
                  stickyTh,
                  "border-b border-line",
                  alignClass(col),
                  col.hideBelow && hideClass[col.hideBelow],
                  col.headerClassName,
                )}
              >
                {col.sortKey && sorting ? (
                  <SortLink {...sorting} label={col.header} sortKey={col.sortKey} align={col.numeric ? "right" : col.align} />
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={colCount}>{empty ?? <EmptyState compact title={t.emptyTitle} body={t.emptyBody} />}</td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                key={ids[index]}
                className={cx(
                  "border-b border-line last:border-b-0 hover:bg-panel-2",
                  selectable && "has-[[data-row-select]:checked]:bg-accent-soft",
                  rowClassName?.(row),
                )}
              >
                {selectable && (
                  <td className={cx(tdClass, "pr-0")}>
                    <RowCheckbox id={ids[index]} label={rowLabel?.(row) ?? ids[index]} />
                  </td>
                )}
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cx(
                      tdClass,
                      alignClass(col),
                      col.numeric && "whitespace-nowrap tabular-nums",
                      col.hideBelow && hideClass[col.hideBelow],
                      col.className,
                    )}
                  >
                    {col.cell(row, index)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const body = (
    <div className={cx("overflow-hidden rounded-card border border-line bg-panel shadow-card", className)}>
      {toolbar}
      {selectable && bulkActions && <BulkActionBar action={bulkAction}>{bulkActions}</BulkActionBar>}
      {table}
      {footer && <div className="border-t border-line">{footer}</div>}
    </div>
  );

  return selectable ? <SelectionProvider ids={ids}>{body}</SelectionProvider> : body;
}

/** Loading placeholder with the same frame as DataTable, for loading.tsx. */
export function DataTableSkeleton({
  columns = 5,
  rows = 8,
  selectable = false,
  toolbar = true,
  label,
}: {
  columns?: number;
  rows?: number;
  selectable?: boolean;
  toolbar?: boolean;
  /** Announced to screen readers, e.g. "Loading inventory". */
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="overflow-hidden rounded-card border border-line bg-panel shadow-card"
    >
      {toolbar && (
        <div className="flex gap-2 border-b border-line px-3.5 py-2.5">
          <Skeleton className="h-7 w-60" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-24" />
        </div>
      )}
      <div className="grid">
        {Array.from({ length: rows + 1 }, (_, r) => (
          <div key={r} className="flex items-center gap-4 border-b border-line px-2.5 py-2.5 last:border-b-0">
            {selectable && <Skeleton className="size-3.5 shrink-0" />}
            {Array.from({ length: columns }, (_, c) => (
              <Skeleton
                key={c}
                className={cx(r === 0 ? "h-2.5" : "h-3.5", c === 0 ? "w-2/5" : "w-1/6", c === columns - 1 && "ml-auto")}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
