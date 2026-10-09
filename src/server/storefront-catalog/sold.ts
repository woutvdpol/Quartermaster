/*
 * Sold archive rules (docs/sold-archive.md). Pure — shared by catalog cards, the product page, JSON-LD,
 * the Markdown alternate and the sitemap, so every surface applies the same two per-item switches:
 *
 *   Product.archiveHidden   the sold item is left out of the archive list, the sitemap and the index
 *                           (the page itself stays reachable for order links and wishlists, noindex)
 *   Product.showSoldPrice   the sold price is shown (default off); never relevant for live items
 *
 * Shop-wide, settings.catalog.publicArchive switches the whole archive (list page, indexing) on or off.
 */

import { SHOP_LOCALE } from "@/components/shop/ui/money";
import { catalogCopy } from "@/components/shop/catalog/_copy";

type StatusLike = { status: string; showSoldPrice: boolean };

const isSold = (status: string) => status === "sold" || status === "SOLD";

/** Whether the visitor may see the price: always for live items; for sold ones only when ticked per item. */
export function priceVisible(item: StatusLike): boolean {
  return !isSold(item.status) || item.showSoldPrice;
}

/** A sold item is part of the public archive (listed, indexable, in the sitemap). */
export function inSoldArchive(item: { status: string; archiveHidden: boolean }, archiveEnabled: boolean): boolean {
  return archiveEnabled && isSold(item.status) && !item.archiveHidden;
}

/**
 * Sold pages are indexable only as part of the public archive; sensitive (`blurred`) items never.
 * Live items are always indexable (other rules — locked, coming soon — are applied by the caller).
 */
export function soldPageNoindex(item: { status: string; archiveHidden: boolean; blurred: boolean }, archiveEnabled: boolean): boolean {
  if (item.blurred) return true;
  return isSold(item.status) && !inSoldArchive(item, archiveEnabled);
}

/** "Oct 2026" (shop locale) for an ISO date; null when missing or invalid. */
export function soldMonth(iso: string | null | undefined, timeZone = "UTC"): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(SHOP_LOCALE, { month: "short", year: "numeric", timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat(SHOP_LOCALE, { month: "short", year: "numeric", timeZone: "UTC" }).format(d);
  }
}

/** "Sold Oct 2026", or "Sold" without a date. */
export function soldLabel(iso: string | null | undefined, timeZone?: string): string {
  const month = soldMonth(iso, timeZone);
  return month ? catalogCopy.product.soldIn(month) : catalogCopy.product.status.sold;
}
