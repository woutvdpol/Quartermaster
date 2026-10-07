"use client";

import { useRef, type ReactNode } from "react";
import { catalogCopy as copy } from "./_copy";

/**
 * Mobile bottom sheet for the facet panel (native <dialog>: focus trap, Esc, backdrop for free).
 * The panel's links navigate client-side; the sheet stays open so several filters can be toggled,
 * then "Show N results" closes it.
 */
export function MobileFilters({ activeCount, total, children }: { activeCount: number; total: number; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="inline-flex h-10 items-center gap-2 rounded-shop-sm border border-shop-line-strong bg-shop-surface px-3 text-sm font-medium text-shop-ink lg:hidden"
        aria-haspopup="dialog"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 5h14M6 10h8M8.5 15h3" strokeLinecap="round" />
        </svg>
        {copy.filters.open}
        {activeCount ? (
          <span className="grid min-w-5 place-items-center rounded-full bg-shop-primary px-1 text-xs text-shop-on-primary tabular-nums">{activeCount}</span>
        ) : null}
      </button>
      <dialog
        ref={ref}
        aria-label={copy.filters.heading}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close(); // backdrop click
        }}
        className="m-0 mt-auto max-h-[88dvh] w-full max-w-none rounded-t-[14px] bg-shop-bg p-0 text-shop-ink shadow-shop-pop backdrop:bg-black/45 open:flex open:flex-col lg:hidden"
      >
        <div className="flex items-center justify-between border-b border-shop-line px-4 py-3">
          <h2 className="text-lg">{copy.filters.heading}</h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="grid size-10 place-items-center rounded-shop-sm hover:bg-shop-sunken"
            aria-label={copy.filters.close}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-5">{children}</div>
        <div className="border-t border-shop-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="h-12 w-full rounded-shop-sm bg-shop-primary font-medium text-shop-on-primary hover:bg-shop-primary-strong"
          >
            {copy.filters.showResults(total)}
          </button>
        </div>
      </dialog>
    </>
  );
}
