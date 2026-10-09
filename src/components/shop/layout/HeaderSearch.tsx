"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SearchField } from "@/components/shop/search/SearchField";
import { fieldCopies } from "@/components/shop/search/_copy-field";
import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { splitLocalePath } from "@/lib/i18n/shop-locales";
import { CloseIcon, SearchIcon } from "./icons";

/** Catalog pages render their own search (which keeps the active filters), so the header one hides there. */
const CATALOG_PREFIXES = ["/shop", "/search", "/archive"];

/**
 * Header search: the combobox field from lg up; on phones/tablets a search button that opens a
 * full-screen sheet with the same field (suggestions flow below it, full width). Hidden on catalog
 * pages, which have their own search box next to the heading (docs/design/search/Results.dc.html).
 */
export function HeaderSearch() {
  const t = useShopCopy(fieldCopies);
  const pathname = usePathname();
  const sheet = useRef<HTMLDialogElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    sheet.current?.close();
  }, [pathname]);
  useEffect(() => {
    if (sheetOpen && !sheet.current?.open) sheet.current?.showModal();
  }, [sheetOpen]);
  const path = splitLocalePath(pathname).path;
  if (CATALOG_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return (
    <>
      <SearchField id="shop-search" className="hidden w-full max-w-[22rem] min-w-[150px] lg:block" />
      <button
        type="button"
        className="grid size-11 shrink-0 place-items-center rounded-shop-control text-shop-ink hover:bg-shop-sunken lg:hidden"
        aria-label={t.open}
        aria-haspopup="dialog"
        onClick={() => setSheetOpen(true)}
      >
        <SearchIcon />
      </button>
      {sheetOpen ? (
        <dialog
          ref={sheet}
          aria-label={t.open}
          onClose={() => setSheetOpen(false)}
          className="m-0 h-dvh max-h-none w-full max-w-none bg-shop-bg p-0 text-shop-ink backdrop:bg-shop-scrim open:flex open:flex-col"
        >
          <div className="flex min-h-0 flex-1 items-start gap-1 overflow-y-auto py-3 pr-2 pl-4">
            <SearchField id="shop-search-sheet" variant="sheet" autoFocus className="min-w-0 flex-1" />
            <button type="button" className="grid size-11 shrink-0 place-items-center rounded-shop-control hover:bg-shop-sunken" aria-label={t.close} onClick={() => sheet.current?.close()}>
              <CloseIcon />
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
