import Link from "next/link";
import { cn } from "@/components/shop/ui";
import { catalogQueryString, type CatalogParams, type CatalogSort, type CatalogView } from "@/server/storefront-catalog";
import { catalogCopy as copy } from "./_copy";

/** Grid / list switch (links, so it works without JS and survives reloads via ?view=). */
export function ViewToggle({ basePath, params, view, defaultSort }: { basePath: string; params: CatalogParams; view: CatalogView; defaultSort: CatalogSort }) {
  const item = (v: CatalogView, label: string, icon: React.ReactNode) => (
    <Link
      href={`${basePath}${catalogQueryString(params, { view: v }, defaultSort)}`}
      scroll={false}
      rel="nofollow"
      aria-label={label}
      aria-current={view === v ? "true" : undefined}
      title={label}
      className={cn(
        "grid h-7 w-9 place-items-center rounded-shop-control transition-colors",
        view === v ? "bg-shop-surface text-shop-ink shadow-shop" : "text-shop-muted hover:text-shop-ink",
      )}
    >
      {icon}
    </Link>
  );
  return (
    <div className="hidden h-9 items-center gap-0.5 rounded-shop-control bg-shop-sunken p-1 sm:flex" role="group" aria-label={copy.toolbar.view}>
      {item(
        "grid",
        copy.toolbar.grid,
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="currentColor">
          <rect x="3" y="3" width="6" height="6" rx="1" />
          <rect x="11" y="3" width="6" height="6" rx="1" />
          <rect x="3" y="11" width="6" height="6" rx="1" />
          <rect x="11" y="11" width="6" height="6" rx="1" />
        </svg>,
      )}
      {item(
        "list",
        copy.toolbar.list,
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="currentColor">
          <rect x="3" y="4" width="4" height="4" rx="1" />
          <rect x="9" y="5" width="8" height="2" rx="1" />
          <rect x="3" y="12" width="4" height="4" rx="1" />
          <rect x="9" y="13" width="8" height="2" rx="1" />
        </svg>,
      )}
    </div>
  );
}
