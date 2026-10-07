"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { PublicMenuItem } from "@/server/content/menus";
import { CloseIcon, MenuIcon } from "./icons";
import { layoutCopy } from "./_copy";
import { MenuLink } from "./MenuLink";

const t = layoutCopy.header;

/**
 * Phone navigation: a modal <dialog> drawer (focus trap, Esc to close and inert background come
 * from the platform). Closes on navigation. `search` is the server-rendered SearchBox.
 */
export function MobileNav({ items, shopName, search }: { items: PublicMenuItem[]; shopName: string; search: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    dialog.current?.close();
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        className="grid size-10 place-items-center rounded-full hover:bg-shop-on-primary/10 lg:hidden"
        aria-label={t.openMenu}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <MenuIcon />
      </button>
      <dialog
        ref={dialog}
        aria-label={t.menu}
        className="m-0 h-dvh max-h-none w-[min(22rem,88vw)] max-w-none bg-shop-bg p-0 text-shop-ink shadow-shop-pop backdrop:bg-black/45 open:flex open:flex-col"
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close(); // backdrop click
        }}
      >
        <div className="flex items-center justify-between border-b border-shop-line px-4 py-3">
          <span className="truncate font-shop-heading text-lg">{shopName}</span>
          <button type="button" className="grid size-10 place-items-center rounded-full hover:bg-shop-sunken" aria-label={t.closeMenu} onClick={() => dialog.current?.close()}>
            <CloseIcon />
          </button>
        </div>
        <div className="border-b border-shop-line p-4 [&_input]:border-shop-line-strong">{search}</div>
        <nav aria-label={t.mainNav} className="flex-1 overflow-y-auto px-2 py-3">
          <ul className="flex flex-col">
            <li>
              <Link href="/shop" className="block rounded-shop-sm px-3 py-2.5 font-medium hover:bg-shop-sunken">
                {t.shop}
              </Link>
            </li>
            {items.map((item) => (
              <li key={item.id}>
                {item.href ? (
                  <MenuLink item={item} className="block rounded-shop-sm px-3 py-2.5 font-medium hover:bg-shop-sunken" />
                ) : (
                  <p className="px-3 pt-4 pb-1 text-xs font-semibold tracking-[0.12em] text-shop-muted uppercase">{item.label}</p>
                )}
                {item.children.length ? (
                  <ul className="mb-2 ml-3 border-l border-shop-line pl-2">
                    {item.children.map((c) => (
                      <li key={c.id}>
                        <MenuLink item={c} className="block rounded-shop-sm px-3 py-2 text-[0.95rem] text-shop-ink-2 hover:bg-shop-sunken" />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>
      </dialog>
    </>
  );
}
