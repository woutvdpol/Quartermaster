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
        className="h-10 w-full rounded-full border border-transparent bg-shop-surface/95 pr-10 pl-4 text-sm text-shop-ink placeholder:text-shop-muted focus:border-shop-secondary focus:outline-none"
      />
      <button type="submit" className="absolute top-0 right-0 grid size-10 place-items-center rounded-full text-shop-muted hover:text-shop-ink" aria-label={t.search}>
        <SearchIcon className="size-[1.1rem]" />
      </button>
    </Form>
  );
}
