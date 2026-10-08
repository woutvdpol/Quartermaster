import Link from "next/link";
import { Suspense } from "react";
import type { PublicMenuItem } from "@/server/content/menus";
import { Container } from "@/components/shop/ui/Container";
import { CurrencySwitcherSlot } from "@/components/shop/currency/CurrencySwitcherSlot";
import { HeaderActions } from "./HeaderActions";
import { ChevronDownIcon } from "./icons";
import { MenuLink } from "./MenuLink";
import { MobileNav } from "./MobileNav";
import { HeaderSearch } from "./HeaderSearch";
import { SearchBox } from "./SearchBox";
import { StickyHeader } from "./StickyHeader";
import { layoutCopy } from "./_copy";

const t = layoutCopy.header;

const topLink = "flex items-center py-2 text-shop-ink-2 transition-colors hover:text-shop-primary";

/**
 * Shop header (one row, "gallery" layout): logo / name, the HEADER menu inline on desktop (two
 * levels; sub-items open on hover and keyboard focus), then search, display-currency switcher and
 * the wishlist-account-cart actions. Phones get a hamburger drawer (MobileNav) holding menu + search.
 * Sticky; tightens once scrolled. The currency switcher reads a cookie, so it streams in behind its
 * own <Suspense>.
 */
export function Header({
  tenantId,
  shopName,
  logoPath,
  menu,
}: {
  tenantId: string;
  shopName: string;
  logoPath: string | null;
  menu: PublicMenuItem[];
}) {
  return (
    <StickyHeader>
      <Container className="flex min-h-16 items-center gap-1.5 py-2.5 transition-[padding] duration-200 sm:gap-3 lg:min-h-20 lg:gap-x-6 lg:py-4 lg:group-data-[scrolled]/header:py-2.5 xl:gap-x-8">
        <MobileNav items={menu} shopName={shopName} search={<SearchBox id="shop-search-mobile" variant="sheet" />} />
        <Link href="/" className="mr-auto flex min-w-0 shrink-0 items-center gap-3 xl:mr-0" aria-label={`${shopName} ${t.homeLabel}`}>
          {logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element -- stored branding asset, already sized
            <img
              src={logoPath}
              alt=""
              className="h-10 w-auto max-w-[180px] object-contain transition-[height] duration-200 group-data-[scrolled]/header:h-8"
            />
          ) : null}
          <span className={logoPath ? "sr-only" : "truncate font-shop-heading text-lg font-bold tracking-[-0.02em] text-shop-ink sm:text-xl"}>{shopName}</span>
        </Link>

        {/* Inline from xl; below that the drawer holds the menu (a full category menu does not fit at 1024px). */}
        <nav aria-label={t.mainNav} className="hidden min-w-0 xl:block">
          <ul className="flex items-center gap-x-5 text-[0.95rem] font-medium whitespace-nowrap">
            <li className="flex">
              <Link href="/shop" className={topLink}>
                {t.shop}
              </Link>
            </li>
            {menu.map((item) => (
              <li key={item.id} className="group/item relative flex items-center gap-1">
                {item.href ? (
                  <MenuLink item={item} className={topLink} />
                ) : (
                  <span className="flex cursor-default items-center py-2 text-shop-ink-2">{item.label}</span>
                )}
                {item.children.length ? (
                  <>
                    <ChevronDownIcon className="pointer-events-none size-3.5 text-shop-muted" />
                    {/* pt-2 bridges the gap so the hover state survives moving into the panel. */}
                    <div className="invisible absolute top-full -left-3 z-50 translate-y-1 pt-2 opacity-0 transition group-focus-within/item:visible group-focus-within/item:translate-y-0 group-focus-within/item:opacity-100 group-hover/item:visible group-hover/item:translate-y-0 group-hover/item:opacity-100">
                      <ul className="min-w-56 rounded-shop border border-shop-line bg-shop-surface p-1.5 text-shop-ink shadow-shop-pop">
                        {item.children.map((c) => (
                          <li key={c.id}>
                            <MenuLink item={c} className="block rounded-shop-sm px-3 py-2 text-shop-ink-2 hover:bg-shop-sunken hover:text-shop-ink" />
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex min-w-0 items-center justify-end gap-1 sm:gap-2.5 lg:flex-1">
          <HeaderSearch />
          <Suspense fallback={null}>
            <CurrencySwitcherSlot tenantId={tenantId} className="hidden sm:block" />
          </Suspense>
          <HeaderActions />
        </div>
      </Container>
    </StickyHeader>
  );
}
