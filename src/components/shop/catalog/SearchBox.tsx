import { SearchField } from "@/components/shop/search/SearchField";
import { HiddenParams } from "./HiddenParams";
import type { CatalogParams, CatalogSort } from "@/server/storefront-catalog";
import { catalogCopy as copy } from "./_copy";

/**
 * Catalog search (GET ?q=) — the same smart-search field as the header (suggestions, photo search),
 * keeping facets/tags/price/sort/view of the current scope; resets paging.
 */
export function SearchBox({ action, params, defaultSort, id = "catalog-q" }: { action: string; params: CatalogParams; defaultSort: CatalogSort; id?: string }) {
  return (
    <SearchField key={params.q ?? ""} id={id} action={action} variant="catalog" defaultValue={params.q ?? ""} placeholder={copy.search.placeholder} className="w-full max-w-xl">
      <HiddenParams params={params} keep={["facets", "tags", "min", "max", "sort", "view"]} defaultSort={defaultSort} />
    </SearchField>
  );
}
