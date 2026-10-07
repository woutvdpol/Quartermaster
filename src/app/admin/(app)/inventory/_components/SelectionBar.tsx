"use client";

import { useEffect, type ReactNode } from "react";
import { cx, useSelection } from "@/components/admin/ui";

/*
 * Design A dark bulk bar (same look as the kit's BulkActionBar) WITHOUT the outer <form>.
 * The kit bar wraps its buttons in a form, which would nest the ConfirmDialog forms we put in it;
 * here every dialog submits the selected ids itself (see IdFields). Esc clears the selection when
 * no dialog is open. Used by the inventory and tags tables.
 */
export function SelectionBar({
  label,
  selectedLabel,
  clearLabel,
  escHint,
  children,
}: {
  label: string;
  selectedLabel: (count: number) => string;
  clearLabel: string;
  escHint?: string;
  /** Usually ConfirmDialogs; their trigger buttons get the dark-bar styling. */
  children: (ids: string[]) => ReactNode;
}) {
  const { selected, clear } = useSelection();
  const ids = [...selected];
  const count = ids.length;

  useEffect(() => {
    if (count === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input:not([type=checkbox]), textarea, select, [contenteditable=true]")) return;
      clear();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count, clear]);

  return (
    <div aria-live="polite">
      {count > 0 && (
        <div role="toolbar" aria-label={label} className="flex flex-wrap items-center gap-2.5 bg-rail px-3.5 py-2 text-[13px] text-rail-ink">
          <span className="font-medium">{selectedLabel(count)}</span>
          <div
            className={cx(
              "flex flex-wrap items-center gap-2",
              "[&>button]:border-rail-active [&>button]:bg-rail-active [&>button]:text-rail-ink [&>button:hover]:bg-rail-raised",
            )}
          >
            {children(ids)}
          </div>
          {escHint && <span className="ml-auto hidden text-xs opacity-70 sm:inline">{escHint}</span>}
          <button
            type="button"
            onClick={clear}
            className={cx("rounded-control border border-rail-active px-2.5 py-1 text-xs hover:bg-rail-raised", !escHint && "ml-auto")}
          >
            {clearLabel}
          </button>
        </div>
      )}
    </div>
  );
}

/** Hidden `ids` inputs for the selected rows, for a dialog's own form. */
export function IdFields({ ids, name = "ids" }: { ids: string[]; name?: string }) {
  return (
    <>
      {ids.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
    </>
  );
}
