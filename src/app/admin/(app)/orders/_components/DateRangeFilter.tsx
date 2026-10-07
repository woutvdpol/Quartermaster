"use client";

import { useState } from "react";
import { DateInput } from "@/components/admin/ui";
import { useUrlParams } from "@/components/admin/ui/use-url-params";
import { ordersCopy } from "../_copy";

const t = ordersCopy.dateFilter;

/** Two native date pickers that write `?from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive, shop time zone). */
export function DateRangeFilter() {
  const { searchParams, setParams } = useUrlParams();
  const urlFrom = searchParams.get("from") ?? "";
  const urlTo = searchParams.get("to") ?? "";
  const [from, setFrom] = useState(urlFrom);
  const [to, setTo] = useState(urlTo);
  const [last, setLast] = useState({ from: urlFrom, to: urlTo });

  // The URL changed elsewhere (e.g. "Clear filters" or a removed chip): adopt it.
  if (urlFrom !== last.from || urlTo !== last.to) {
    setLast({ from: urlFrom, to: urlTo });
    setFrom(urlFrom);
    setTo(urlTo);
  }

  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="sr-only">{t.legend}</legend>
      <span className="w-[9.5rem]">
        <DateInput
          aria-label={t.from}
          value={from}
          max={to || undefined}
          onChange={(e) => {
            setFrom(e.target.value);
            setParams({ from: e.target.value || null });
          }}
        />
      </span>
      <span aria-hidden="true" className="text-xs text-muted">
        –
      </span>
      <span className="w-[9.5rem]">
        <DateInput
          aria-label={t.to}
          value={to}
          min={from || undefined}
          onChange={(e) => {
            setTo(e.target.value);
            setParams({ to: e.target.value || null });
          }}
        />
      </span>
    </fieldset>
  );
}
