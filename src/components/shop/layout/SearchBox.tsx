import Form from "next/form";
import { cn } from "@/components/shop/ui/cn";
import { SearchIcon } from "./icons";
import { layoutCopy } from "./_copy";

const t = layoutCopy.header;

/**
 * GET form to /shop?q=… (the catalog agent owns /shop). next/form prefetches /shop and navigates
 * client-side; without JS it is a plain form submit.
 */
export function SearchBox({ className, id = "shop-search", autoFocus }: { className?: string; id?: string; autoFocus?: boolean }) {
  return (
    <Form action="/shop" role="search" className={cn("relative", className)}>
      <label htmlFor={id} className="sr-only">
        {t.searchLabel}
      </label>
      <input
        id={id}
        name="q"
        type="search"
        autoComplete="off"
        enterKeyHint="search"
        maxLength={200}
        placeholder={t.searchPlaceholder}
        autoFocus={autoFocus}
        className="h-11 w-full appearance-none rounded-shop-control border border-transparent bg-shop-sunken pr-4 pl-11 text-[0.95rem] text-shop-ink placeholder:text-shop-muted focus:border-shop-line-strong focus:bg-shop-surface focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      <button type="submit" className="absolute top-0 left-0 grid size-11 place-items-center rounded-shop-control text-shop-muted hover:text-shop-ink" aria-label={t.search}>
        <SearchIcon className="size-[1.1rem]" />
      </button>
    </Form>
  );
}
