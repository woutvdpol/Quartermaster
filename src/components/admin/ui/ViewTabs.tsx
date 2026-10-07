import Link from "next/link";
import type { ReactNode } from "react";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { hrefWith, type SearchParamsInput } from "./url";

const t = getDictionary().ui.views;

export type ViewTab = {
  /** URL value; null for the default view (no parameter). */
  value: string | null;
  label: ReactNode;
  count?: number;
};

type ViewTabsProps = {
  views: ViewTab[];
  /** Current value from the URL (null/undefined = default view). */
  active: string | null | undefined;
  basePath: string;
  searchParams: SearchParamsInput;
  param?: string;
  label?: string;
  className?: string;
};

/** Saved views with counts (design A `.views`), driven by a URL param. Switching resets the page. */
export function ViewTabs({ views, active, basePath, searchParams, param = "view", label = t.label, className }: ViewTabsProps) {
  return (
    <nav aria-label={label} className={cx("overflow-x-auto px-3.5 shadow-[inset_0_-1px_0_var(--qm-line)]", className)}>
      <ul className="flex gap-0.5">
        {views.map((view) => {
          const current = (active ?? null) === view.value;
          return (
            <li key={view.value ?? "_default"}>
              <Link
                href={hrefWith(basePath, searchParams, { [param]: view.value, page: null })}
                aria-current={current ? "page" : undefined}
                className={cx(
                  "flex items-center gap-1 border-b-2 px-2.5 py-[9px] text-[13px] whitespace-nowrap transition-colors",
                  "focus-visible:-outline-offset-2",
                  current ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {view.label}
                {view.count !== undefined && <span className="font-mono text-[11px] text-muted tabular-nums">{view.count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
