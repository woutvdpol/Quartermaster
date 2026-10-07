"use client";

import Form from "next/form";
import { useId } from "react";
import { catalogCopy as copy } from "./_copy";

/**
 * Sort dropdown inside a GET form: changing it submits the form (the server re-renders from the URL).
 * Without JS a visible "Apply" button does the same. Other params travel as hidden inputs (children).
 */
export function SortSelect({
  action,
  value,
  options,
  children,
}: {
  action: string;
  value: string;
  options: { value: string; label: string }[];
  children?: React.ReactNode;
}) {
  const id = useId();
  return (
    <Form action={action} scroll={false} className="flex items-center gap-2">
      {children}
      <label htmlFor={id} className="sr-only text-sm whitespace-nowrap text-shop-muted sm:not-sr-only">
        {copy.toolbar.sort}
      </label>
      <span className="relative inline-flex">
        <select
          id={id}
          name="sort"
          defaultValue={value}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="h-9 cursor-pointer appearance-none rounded-shop-control border border-shop-line-strong bg-shop-surface pr-9 pl-4 text-sm font-medium text-shop-ink transition-colors hover:border-shop-ink"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-shop-muted" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <noscript>
        <button type="submit" className="h-9 rounded-shop-control border border-shop-line-strong px-4 text-sm font-medium">
          {copy.toolbar.apply}
        </button>
      </noscript>
    </Form>
  );
}
