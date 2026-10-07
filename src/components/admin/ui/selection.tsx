"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";

const t = getDictionary().ui;

type SelectionContextValue = {
  ids: readonly string[];
  selected: ReadonlySet<string>;
  toggle: (id: string, on?: boolean) => void;
  setAll: (on: boolean) => void;
  clear: () => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

/** Row selection state for a table. DataTable adds this automatically when `selectable`. */
export function SelectionProvider({ ids, children }: { ids: readonly string[]; children: ReactNode }) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  // Drop ids that are no longer on the page (after pagination, filtering or a bulk action).
  const selected = useMemo(() => new Set([...picked].filter((id) => ids.includes(id))), [picked, ids]);

  const value = useMemo<SelectionContextValue>(
    () => ({
      ids,
      selected,
      toggle: (id, on) =>
        setPicked((prev) => {
          const next = new Set(prev);
          if (on ?? !next.has(id)) next.add(id);
          else next.delete(id);
          return next;
        }),
      setAll: (on) => setPicked(on ? new Set(ids) : new Set()),
      clear: () => setPicked(new Set()),
    }),
    [ids, selected],
  );
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/** Selection state from the nearest SelectionProvider (e.g. for custom bulk buttons). */
export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used inside <SelectionProvider> (DataTable selectable).");
  return ctx;
}

const boxClass = "size-3.5 cursor-pointer accent-accent align-middle";

export function RowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      data-row-select=""
      className={boxClass}
      checked={selected.has(id)}
      onChange={(e) => toggle(id, e.target.checked)}
      aria-label={t.table.selectRow(label)}
    />
  );
}

export function SelectAllCheckbox() {
  const { ids, selected, setAll } = useSelection();
  const ref = useRef<HTMLInputElement>(null);
  const all = ids.length > 0 && selected.size === ids.length;
  const some = selected.size > 0 && !all;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={boxClass}
      checked={all}
      disabled={ids.length === 0}
      onChange={(e) => setAll(e.target.checked)}
      aria-label={t.table.selectAll}
    />
  );
}

type BulkActionBarProps = {
  /**
   * Buttons for the selected rows. They sit inside a <form> that contains one hidden `ids` input per
   * selected row, so `<button formAction={archiveProducts}>` or a form-level `action` receives
   * `formData.getAll("ids")`. Client buttons can call useSelection() instead.
   */
  children: ReactNode;
  /** Default form action for the buttons (each button may override with formAction). */
  action?: (formData: FormData) => void | Promise<void>;
  /** Name of the hidden id inputs (default "ids"). */
  name?: string;
  className?: string;
};

/** Design A dark bulk bar, shown only while rows are selected. */
export function BulkActionBar({ children, action, name = "ids", className }: BulkActionBarProps) {
  const { selected, clear } = useSelection();
  const count = selected.size;
  return (
    <div aria-live="polite" className={className}>
      {count > 0 && (
        <form
          action={action}
          aria-label={t.bulk.label}
          className={cx(
            "flex flex-wrap items-center gap-2.5 bg-rail px-3.5 py-2 text-[13px] text-rail-ink",
            "[&_button]:border-rail-active [&_button]:bg-rail-active [&_button]:text-rail-ink [&_button:hover]:bg-rail-raised",
          )}
        >
          {[...selected].map((id) => (
            <input key={id} type="hidden" name={name} value={id} />
          ))}
          <span className="font-medium">{t.bulk.selected(count)}</span>
          <div className="flex flex-wrap items-center gap-2">{children}</div>
          <button
            type="button"
            onClick={clear}
            className="ml-auto rounded-control border px-2.5 py-1 text-xs"
          >
            {t.bulk.clear}
          </button>
        </form>
      )}
    </div>
  );
}
