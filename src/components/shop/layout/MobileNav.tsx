"use client";

import Link from "@/components/shop/ui/Link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { PublicMenuItem } from "@/server/content/menus";
import { LanguageSwitcher } from "@/components/shop/i18n/LanguageSwitcher";
import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { CloseIcon, MenuIcon } from "./icons";
import { layoutCopies } from "./_copy";
import { MenuLink } from "./MenuLink";

/**
 * Phone navigation: a modal <dialog> drawer (focus trap, Esc to close and inert background come
 * from the platform). Closes on navigation. `search` is the search field (suggestions flow below it in the drawer).
 * The language switcher sits at the bottom of the drawer (the header bar hides it on small phones).
 */
export function MobileNav({ items, shopName, search }: { items: PublicMenuItem[]; shopName: string; search: React.ReactNode }) {
  const t = useShopCopy(layoutCopies).header;
  const dialog = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    dialog.current?.close();
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        className="-ml-2 grid size-11 shrink-0 place-items-center rounded-shop-control text-shop-ink hover:bg-shop-sunken xl:hidden"
        aria-label={t.openMenu}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <MenuIcon />
      </button>
      <dialog
        ref={dialog}
        aria-label={t.menu}
        className="m-0 h-dvh max-h-none w-[min(22rem,88vw)] max-w-none bg-shop-bg p-0 text-shop-ink shadow-shop-pop backdrop:bg-shop-scrim open:flex open:flex-col"
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close(); // backdrop click
        }}
      >
        <div className="flex items-center justify-between border-b border-shop-line py-3 pr-2 pl-5">
          <span className="truncate font-shop-heading text-lg font-bold tracking-[-0.02em]">{shopName}</span>
          <button type="button" className="grid size-11 place-items-center rounded-shop-control hover:bg-shop-sunken" aria-label={t.closeMenu} onClick={() => dialog.current?.close()}>
            <CloseIcon />
          </button>
        </div>
        <div className="p-4 pb-2">{search}</div>
        <nav aria-label={t.mainNav} className="flex-1 overflow-y-auto px-2 py-3">
          <ul className="flex flex-col">
            <li>
              <Link href="/shop" className="block rounded-shop-sm px-3 py-3 text-[1.05rem] font-medium hover:bg-shop-sunken">
                {t.shop}
              </Link>
            </li>
            {items.map((item) => (
              <li key={item.id}>
                {item.href ? (
                  <MenuLink item={item} className="block rounded-shop-sm px-3 py-3 text-[1.05rem] font-medium hover:bg-shop-sunken" />
                ) : (
                  <p className="px-3 pt-5 pb-1 text-sm font-semibold text-shop-muted">{item.label}</p>
                )}
                {item.children.length ? (
                  <ul className="mb-2 ml-3 border-l border-shop-line pl-2">
                    {item.children.map((c) => (
                      <li key={c.id}>
                        <MenuLink item={c} className="block rounded-shop-sm px-3 py-2.5 text-[0.95rem] text-shop-ink-2 hover:bg-shop-sunken" />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>
        <LanguageSwitcher className="border-t border-shop-line px-5 py-4" />
      </dialog>
    </>
  );
}
