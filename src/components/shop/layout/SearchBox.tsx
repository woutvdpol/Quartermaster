import { SearchField } from "@/components/shop/search/SearchField";

/**
 * Shop search box (GET /shop?q=…) with search-as-you-type and photo search — a thin wrapper around
 * the smart-search field (src/components/shop/search/SearchField.tsx), kept for existing imports.
 */
export function SearchBox({ className, id = "shop-search", autoFocus, variant = "header" }: { className?: string; id?: string; autoFocus?: boolean; variant?: "header" | "sheet" }) {
  return <SearchField id={id} className={className} autoFocus={autoFocus} variant={variant} />;
}
