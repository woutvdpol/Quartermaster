"use client";

import { useEffect, useState } from "react";
import { ProductGrid } from "@/components/shop/ui/ProductGrid";
import { SectionHeading } from "@/components/shop/ui/SectionHeading";
import type { DisplayCurrency, ProductCardData } from "@/components/shop/ui/types";
import { useShopCopy, useShopLocale } from "@/components/shop/i18n/ShopLocale";
import { recentCopies } from "./_copy";
import { getRecentlyViewedCards } from "./actions";
import { readRecent } from "./storage";

/**
 * "Recently viewed" strip. Reads ids from this browser's localStorage (per shop host), fetches the
 * public cards and renders a ProductGrid. Renders nothing when there is nothing to show (no history,
 * storage blocked, all items gone) — so it is safe to mount anywhere.
 *
 * Props:
 *  - exclude: product id to leave out (the product currently shown).
 *  - limit: max cards (default 4 = one desktop row; max 12).
 *  - title: heading text (default: "Recently viewed" in the visitor's language).
 *  - columns / display / showStockCode: passed to ProductGrid.
 */
export function RecentlyViewed({
  exclude,
  limit = 4,
  title,
  columns = 4,
  display,
  showStockCode,
  className,
}: {
  exclude?: string;
  limit?: number;
  title?: string;
  columns?: 3 | 4;
  display?: DisplayCurrency | null;
  showStockCode?: boolean;
  className?: string;
}) {
  const locale = useShopLocale();
  const t = useShopCopy(recentCopies);
  const heading = title ?? t.title;
  const [cards, setCards] = useState<ProductCardData[] | null>(null);

  useEffect(() => {
    const ids = readRecent(window.location.host).filter((id) => id !== exclude);
    if (!ids.length) return;
    let cancelled = false;
    getRecentlyViewedCards(ids)
      .then((rows) => {
        if (!cancelled) setCards(rows.slice(0, Math.max(1, Math.min(limit, 12))));
      })
      .catch(() => {
        // Optional strip: fail silently.
      });
    return () => {
      cancelled = true;
    };
  }, [exclude, limit]);

  if (!cards?.length) return null;
  return (
    <section aria-label={heading} className={className}>
      <SectionHeading title={heading} />
      <ProductGrid products={cards} columns={columns} display={display} showStockCode={showStockCode} locale={locale} />
    </section>
  );
}
