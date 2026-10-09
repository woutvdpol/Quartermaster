"use client";

import { useRef, type ReactNode } from "react";
import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { catalogCopies } from "./_copy";

/**
 * Mobile bottom sheet for the facet panel (native <dialog>: focus trap, Esc, backdrop for free).
 * The panel's links navigate client-side; the sheet stays open so several filters can be toggled,
 * then "Show N results" closes it.
 */
export function MobileFilters({ activeCount, total, children }: { activeCount: number; total: number; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const copy = useShopCopy(catalogCopies);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="inline-flex h-9 items-center gap-2 rounded-shop-control border border-shop-line-strong bg-shop-surface px-4 text-sm font-medium text-shop-ink transition-colors hover:border-shop-ink lg:hidden"
        aria-haspopup="dialog"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 5h14M6 10h8M8.5 15h3" strokeLinecap="round" />
        </svg>
        {copy.filters.open}
        {activeCount ? (
          <span className="grid h-5 min-w-5 place-items-center rounded-shop-control bg-shop-primary px-1.5 text-xs font-semibold text-shop-on-primary tabular-nums">{activeCount}</span>
        ) : null}
      </button>
      <dialog
        ref={ref}
        aria-label={copy.filters.heading}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close(); // backdrop click
        }}
        className="m-0 mt-auto max-h-[88dvh] w-full max-w-none rounded-t-shop bg-shop-bg p-0 text-shop-ink shadow-shop-pop backdrop:bg-shop-scrim open:flex open:flex-col lg:hidden"
      >
        <div className="relative flex items-center justify-between border-b border-shop-line px-5 pt-5 pb-3">
          <span aria-hidden="true" className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-shop-control bg-shop-line-strong" />
          <h2 className="text-xl">{copy.filters.heading}</h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="grid size-10 place-items-center rounded-shop-control hover:bg-shop-sunken"
            aria-label={copy.filters.close}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-6">{children}</div>
        <div className="border-t border-shop-line px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="h-12 w-full rounded-shop-control bg-shop-primary font-semibold text-shop-on-primary transition-colors hover:bg-shop-primary-strong"
          >
            {copy.filters.showResults(total)}
          </button>
        </div>
      </dialog>
    </>
  );
}
