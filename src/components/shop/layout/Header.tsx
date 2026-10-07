import Link from "next/link";
import type { PublicMenuItem } from "@/server/content/menus";
import { Container } from "@/components/shop/ui/Container";
import { HeaderActions } from "./HeaderActions";
import { ChevronDownIcon } from "./icons";
import { MenuLink } from "./MenuLink";
import { MobileNav } from "./MobileNav";
import { SearchBox } from "./SearchBox";
import { StickyHeader } from "./StickyHeader";
import { layoutCopy } from "./_copy";

const t = layoutCopy.header;

/**
 * Shop header: logo / name, search, wishlist-account-cart actions, and the HEADER menu (two levels;
 * sub-items open on hover and keyboard focus). Sticky; shrinks once scrolled.
 */
export function Header({ shopName, logoPath, menu }: { shopName: string; logoPath: string | null; menu: PublicMenuItem[] }) {
  return (
    <StickyHeader>
      <Container size="wide" className="flex h-16 items-center gap-2 transition-[height] duration-200 group-data-[scrolled]/header:h-14 sm:gap-4">
        <MobileNav items={menu} shopName={shopName} search={<SearchBox id="shop-search-mobile" />} />
        <Link href="/" className="mr-auto flex min-w-0 items-center gap-3 lg:mr-0" aria-label={`${shopName} ${t.homeLabel}`}>
          {logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element -- stored branding asset, already sized
            <img
              src={logoPath}
              alt=""
              className="h-10 w-auto max-w-[180px] object-contain transition-[height] duration-200 group-data-[scrolled]/header:h-8"
            />
          ) : null}
          <span className={logoPath ? "sr-only" : "truncate font-shop-heading text-xl tracking-wide sm:text-2xl"}>{shopName}</span>
        </Link>
        <SearchBox className="mx-auto hidden w-full max-w-md lg:block" />
        <HeaderActions className="ml-auto lg:ml-0" />
      </Container>
      <nav aria-label={t.mainNav} className="hidden border-t border-shop-on-primary/15 lg:block">
        <Container size="wide">
          <ul className="flex h-11 items-stretch gap-1 text-[0.9rem]">
            <li className="flex">
              <Link href="/shop" className="flex items-center px-3 font-medium hover:bg-shop-on-primary/10">
                {t.shop}
              </Link>
            </li>
            {menu.map((item) => (
              <li key={item.id} className="group/item relative flex">
                {item.href ? (
                  <MenuLink item={item} className="flex items-center gap-1 px-3 hover:bg-shop-on-primary/10" />
                ) : (
                  <span className="flex cursor-default items-center gap-1 px-3">{item.label}</span>
                )}
                {item.children.length ? (
                  <>
                    <ChevronDownIcon className="pointer-events-none -ml-2 size-3.5 self-center opacity-70" />
                    <ul className="invisible absolute top-full left-0 z-50 min-w-56 translate-y-1 rounded-b-shop border border-shop-line bg-shop-surface py-2 text-shop-ink opacity-0 shadow-shop-pop transition group-focus-within/item:visible group-focus-within/item:translate-y-0 group-focus-within/item:opacity-100 group-hover/item:visible group-hover/item:translate-y-0 group-hover/item:opacity-100">
                      {item.children.map((c) => (
                        <li key={c.id}>
                          <MenuLink item={c} className="block px-4 py-2 hover:bg-shop-sunken" />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Container>
      </nav>
    </StickyHeader>
  );
}
