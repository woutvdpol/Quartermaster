import Form from "next/form";
import { HiddenParams } from "./HiddenParams";
import type { CatalogParams, CatalogSort } from "@/server/storefront-catalog";
import { catalogCopy as copy } from "./_copy";

/** Catalog search (GET ?q=). Keeps facets/tags/price/sort/view of the current scope; resets paging. */
export function SearchBox({ action, params, defaultSort, id = "catalog-q" }: { action: string; params: CatalogParams; defaultSort: CatalogSort; id?: string }) {
  return (
    <Form action={action} role="search" className="flex w-full max-w-xl items-stretch">
      <HiddenParams params={params} keep={["facets", "tags", "min", "max", "sort", "view"]} defaultSort={defaultSort} />
      <label htmlFor={id} className="sr-only">
        {copy.search.label}
      </label>
      <input
        id={id}
        name="q"
        type="search"
        defaultValue={params.q ?? ""}
        maxLength={100}
        placeholder={copy.search.placeholder}
        className="h-11 min-w-0 flex-1 rounded-l-shop-sm border border-r-0 border-shop-line-strong bg-shop-surface px-3 text-[0.95rem] text-shop-ink placeholder:text-shop-muted/80 focus:border-shop-primary focus:outline-none"
      />
      <button type="submit" className="h-11 rounded-r-shop-sm bg-shop-primary px-4 text-sm font-medium text-shop-on-primary hover:bg-shop-primary-strong">
        {copy.search.submit}
      </button>
    </Form>
  );
}
