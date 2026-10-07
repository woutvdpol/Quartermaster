"use client";

import { useEffect, useRef, useState } from "react";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { Spinner } from "./Spinner";
import { useUrlParams } from "./use-url-params";

const t = getDictionary().ui.search;

type SearchInputProps = {
  /** URL parameter (default "q"). */
  param?: string;
  /** Accessible label (visually hidden). */
  label?: string;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
};

/**
 * Debounced search box that writes `?q=` with router.replace (no history spam) and resets the page.
 * Needs a <Suspense> boundary above it on statically rendered pages (uses useSearchParams).
 */
export function SearchInput({ param = "q", label = t.label, placeholder = t.placeholder, debounceMs = 300, className }: SearchInputProps) {
  const { searchParams, setParams, pending } = useUrlParams();
  const urlValue = searchParams.get(param) ?? "";
  const [text, setText] = useState(urlValue);
  const [lastUrlValue, setLastUrlValue] = useState(urlValue);
  const timer = useRef<number | undefined>(undefined);

  // The URL changed elsewhere (e.g. "Clear filters"): adopt it.
  if (urlValue !== lastUrlValue) {
    setLastUrlValue(urlValue);
    setText(urlValue);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function schedule(value: string) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setParams({ [param]: value.trim() || null }), debounceMs);
  }

  return (
    <search className={cx("relative min-w-[220px] flex-1 sm:max-w-[320px] sm:flex-none", className)}>
      <label className="sr-only" htmlFor={`search-${param}`}>
        {label}
      </label>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-muted">
        {pending ? <Spinner className="size-3" /> : <MagnifierIcon />}
      </span>
      <input
        id={`search-${param}`}
        type="search"
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          schedule(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            window.clearTimeout(timer.current);
            setParams({ [param]: text.trim() || null });
          }
        }}
        className="block w-full rounded-control border border-line bg-panel py-1.5 pr-2.5 pl-8 text-[13px] text-ink placeholder:text-muted hover:border-line-strong"
      />
      <span role="status" className="sr-only">
        {pending ? t.searching : ""}
      </span>
    </search>
  );
}

function MagnifierIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="7" cy="7" r="5" />
      <path d="m11 11 3.5 3.5" strokeLinecap="round" />
    </svg>
  );
}
