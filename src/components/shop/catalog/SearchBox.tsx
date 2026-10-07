import Form from "next/form";
import { HiddenParams } from "./HiddenParams";
import type { CatalogParams, CatalogSort } from "@/server/storefront-catalog";
import { catalogCopy as copy } from "./_copy";

/** Catalog search (GET ?q=). Keeps facets/tags/price/sort/view of the current scope; resets paging. */
export function SearchBox({ action, params, defaultSort, id = "catalog-q" }: { action: string; params: CatalogParams; defaultSort: CatalogSort; id?: string }) {
  return (
    <Form
      action={action}
      role="search"
      className="flex h-12 w-full max-w-xl items-center gap-2 rounded-shop-control border border-transparent bg-shop-sunken pr-1.5 pl-4 focus-within:border-shop-line-strong focus-within:bg-shop-surface"
    >
      <HiddenParams params={params} keep={["facets", "tags", "min", "max", "sort", "view"]} defaultSort={defaultSort} />
      <label htmlFor={id} className="sr-only">
        {copy.search.label}
      </label>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0 text-shop-muted" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input
        id={id}
        name="q"
        type="search"
        defaultValue={params.q ?? ""}
        maxLength={100}
        placeholder={copy.search.placeholder}
        className="h-full min-w-0 flex-1 bg-transparent text-[0.95rem] text-shop-ink placeholder:text-shop-muted focus:outline-none"
      />
      <button type="submit" className="h-9 shrink-0 rounded-shop-control bg-shop-primary px-4 text-sm font-semibold text-shop-on-primary transition-colors hover:bg-shop-primary-strong">
        {copy.search.submit}
      </button>
    </Form>
  );
}
