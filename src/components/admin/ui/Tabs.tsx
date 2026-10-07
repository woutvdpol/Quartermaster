"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export type TabItem = {
  id: string;
  label: ReactNode;
  content: ReactNode;
  /** Small count or badge after the label. */
  badge?: ReactNode;
  disabled?: boolean;
};

type TabsProps = {
  items: TabItem[];
  /** Accessible name of the tab list. */
  label: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (id: string) => void;
  className?: string;
  panelClassName?: string;
};

/**
 * WAI-ARIA tabs with automatic activation: ←/→ move between tabs, Home/End jump. Inactive panels
 * stay mounted (hidden) so form fields inside keep their values and still submit.
 * For URL-driven list views use <ViewTabs/> instead.
 */
export function Tabs({ items, label, defaultValue, value, onValueChange, className, panelClassName }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue ?? items.find((i) => !i.disabled)?.id);
  const active = value ?? internal;
  const baseId = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  function select(id: string) {
    if (value === undefined) setInternal(id);
    onValueChange?.(id);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const enabled = items.filter((i) => !i.disabled);
    const index = enabled.findIndex((i) => i.id === active);
    let next: TabItem | undefined;
    if (e.key === "ArrowRight") next = enabled[(index + 1) % enabled.length];
    else if (e.key === "ArrowLeft") next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    select(next.id);
    tabRefs.current.get(next.id)?.focus();
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-0.5 overflow-x-auto shadow-[inset_0_-1px_0_var(--qm-line)]">
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              ref={(el) => {
                if (el) tabRefs.current.set(item.id, el);
                else tabRefs.current.delete(item.id);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.id)}
              className={cx(
                "flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] whitespace-nowrap transition-colors",
                "focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                selected ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
              )}
            >
              {item.label}
              {item.badge !== undefined && <span className="font-mono text-[11px] text-muted">{item.badge}</span>}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== active}
          tabIndex={0}
          className={cx("pt-4 focus-visible:outline-offset-4", panelClassName)}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
