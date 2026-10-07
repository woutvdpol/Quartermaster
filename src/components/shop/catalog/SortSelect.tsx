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
      <label htmlFor={id} className="text-sm whitespace-nowrap text-shop-muted">
        {copy.toolbar.sort}
      </label>
      <select
        id={id}
        name="sort"
        defaultValue={value}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-10 rounded-shop-sm border border-shop-line-strong bg-shop-surface px-2 pr-8 text-sm text-shop-ink"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="h-10 rounded-shop-sm border border-shop-line-strong px-3 text-sm">
          {copy.toolbar.apply}
        </button>
      </noscript>
    </Form>
  );
}
