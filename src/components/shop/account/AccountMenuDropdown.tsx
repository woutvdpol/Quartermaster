"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { accountCopy } from "./_copy";
import { logoutCustomerAction } from "./actions";

const t = accountCopy.account.nav;

/** Disclosure menu for a signed-in customer (keyboard: Esc closes, focus returns to the trigger). */
export function AccountMenuDropdown({ name, email }: { name: string | null; email: string }) {
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState<string | null>(null);
  const pathname = usePathname();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Close after navigating.
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "block rounded-shop-sm px-3 py-2 text-sm text-shop-ink hover:bg-shop-sunken";
  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-10 items-center gap-2 rounded-shop-sm px-2.5 text-sm font-medium text-shop-ink hover:bg-shop-sunken"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20.5c1.4-3.8 4.4-5.5 8-5.5s6.6 1.7 8 5.5" strokeLinecap="round" />
        </svg>
        <span className="hidden max-w-[10rem] truncate sm:inline">{name ?? accountCopy.menu.account}</span>
        <span className="sr-only sm:hidden">{accountCopy.menu.openMenu}</span>
      </button>
      <div
        id={id}
        hidden={!open}
        className="absolute right-0 z-50 mt-2 w-64 rounded-shop border border-shop-line bg-shop-surface p-2 shadow-shop-pop"
      >
        <p className="truncate px-3 pt-1 pb-2 text-xs text-shop-muted">
          {accountCopy.menu.signedInAs} <span className="text-shop-ink-2">{email}</span>
        </p>
        <nav aria-label={t.label}>
          <ul>
            <li>
              <Link href="/account" className={item}>
                {t.overview}
              </Link>
            </li>
            <li>
              <Link href="/account/orders" className={item}>
                {t.orders}
              </Link>
            </li>
            <li>
              <Link href="/wishlist" className={item}>
                {t.wishlist}
              </Link>
            </li>
            <li>
              <Link href="/account/addresses" className={item}>
                {t.addresses}
              </Link>
            </li>
            <li>
              <Link href="/account/profile" className={item}>
                {t.profile}
              </Link>
            </li>
          </ul>
        </nav>
        <form action={logoutCustomerAction} className="mt-1 border-t border-shop-line pt-1">
          <button type="submit" className={`${item} w-full text-left`}>
            {t.logout}
          </button>
        </form>
      </div>
    </div>
  );
}
