"use client";

import { usePathname } from "next/navigation";
import { SearchBox } from "./SearchBox";

/** Catalog pages render their own search (which keeps the active filters), so the header one hides there. */
const CATALOG_PREFIXES = ["/shop", "/search", "/archive"];

export function HeaderSearch({ className }: { className?: string }) {
  const pathname = usePathname();
  if (CATALOG_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return <SearchBox className={className} />;
}
