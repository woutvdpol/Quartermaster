import Link from "next/link";
import type { ReactNode } from "react";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { getParam, hrefWith, type SearchParamsInput } from "./url";

const t = getDictionary().ui.filters;

/** Toolbar row above a table (design A `.toolbar`): search, filter chips, selects, actions. */
export function FilterBar({ children, end, className }: { children: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={t.label} className={cx("flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5", className)}>
      {children}
      {end && <div className="ml-auto flex flex-wrap items-center gap-2">{end}</div>}
    </div>
  );
}

const chipBase = "inline-flex items-center gap-1 rounded-full border px-2.5 py-[3px] text-xs whitespace-nowrap transition-colors";

type FilterChipProps = {
  /** URL parameter this chip represents. */
  param: string;
  label: string;
  /** Human label for the current value (defaults to the raw param value). */
  valueLabel?: ReactNode;
  basePath: string;
  searchParams: SearchParamsInput;
  /** When the filter is not set: where the dashed "+ label" chip links (e.g. a picker). Omit to hide. */
  addHref?: string;
};

/**
 * Removable filter chip (design A `.chip`). Set: solid chip "Label: value ×" linking to the URL
 * without the param. Unset: dashed "+ Label" chip if `addHref` is given.
 */
export function FilterChip({ param, label, valueLabel, basePath, searchParams, addHref }: FilterChipProps) {
  const value = getParam(searchParams, param);
  if (!value) {
    if (!addHref) return null;
    return (
      <Link href={addHref} className={cx(chipBase, "border-dashed border-line-strong text-muted hover:text-ink")}>
        <span aria-hidden="true">+</span> {label}
      </Link>
    );
  }
  return (
    <span className={cx(chipBase, "border-line bg-panel-2 pr-1 text-ink")}>
      <span>
        <span className="text-muted">{label}:</span> {valueLabel ?? value}
      </span>
      <Link
        href={hrefWith(basePath, searchParams, { [param]: null, page: null })}
        replace
        scroll={false}
        aria-label={t.remove(label)}
        className="grid size-4 place-items-center rounded-full text-muted hover:bg-panel-3 hover:text-ink"
      >
        <span aria-hidden="true">×</span>
      </Link>
    </span>
  );
}

/** "Clear filters" link removing the given params (shown only when one of them is set). */
export function ClearFiltersLink({
  params,
  basePath,
  searchParams,
}: {
  params: string[];
  basePath: string;
  searchParams: SearchParamsInput;
}) {
  if (!params.some((p) => getParam(searchParams, p))) return null;
  const patch = Object.fromEntries([...params, "page"].map((p) => [p, null]));
  return (
    <Link href={hrefWith(basePath, searchParams, patch)} replace scroll={false} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
      {t.clearAll}
    </Link>
  );
}
