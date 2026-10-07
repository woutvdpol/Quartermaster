"use client";

import { useId } from "react";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { useUrlParams } from "./use-url-params";

const t = getDictionary().ui.filters;

type FilterSelectProps = {
  param: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  /** Label of the empty option (default "Any"). */
  anyLabel?: string;
  className?: string;
};

/** Compact select that sets a URL filter param on change (pairs with FilterChip for removal). */
export function FilterSelect({ param, label, options, anyLabel = t.any, className }: FilterSelectProps) {
  const { searchParams, setParams } = useUrlParams();
  const id = useId();
  const value = searchParams.get(param) ?? "";
  return (
    <span className={cx("relative inline-flex items-center", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => setParams({ [param]: e.target.value || null })}
        className={cx(
          "cursor-pointer appearance-none rounded-full border py-[3px] pr-6 pl-2.5 text-xs",
          value ? "border-line bg-panel-2 text-ink" : "border-dashed border-line-strong bg-transparent text-muted",
        )}
      >
        <option value="">
          {label}: {anyLabel}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {label}: {o.label}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-2 text-[8px] text-muted">
        ▼
      </span>
    </span>
  );
}
