import type { ReactNode } from "react";
import { cn } from "./cn";
import { ProductCard } from "./ProductCard";
import type { DisplayCurrency, ProductCardData } from "./types";
import type { ShopLocale } from "@/lib/i18n/shop-locales";

/**
 * Responsive grid of ProductCards: 2 columns on phones, 3 on tablets, `columns` (3|4, from
 * catalog.gridColumns) on desktop. `wishlistSlot(product)` lets callers inject a per-card button.
 * The first `priorityCount` images load eagerly.
 */
export function ProductGrid({
  products,
  columns = 4,
  display,
  showStockCode,
  wishlistSlot,
  priorityCount = 0,
  headingLevel,
  className,
  locale,
}: {
  products: ProductCardData[];
  columns?: 3 | 4;
  display?: DisplayCurrency | null;
  showStockCode?: boolean;
  wishlistSlot?: (product: ProductCardData) => ReactNode;
  priorityCount?: number;
  headingLevel?: 2 | 3 | 4;
  className?: string;
  locale: ShopLocale;
}) {
  // Measured card widths: 171/182 css px on 390/412 phones (2 columns minus padding and gap), 224 on a
  // 768 tablet (3 columns), 228–300 on desktop depending on the catalog sidebar.
  const sizes =
    columns === 4
      ? "(min-width: 1024px) 280px, (min-width: 768px) calc(33vw - 32px), calc(50vw - 24px)"
      : "(min-width: 1024px) 380px, (min-width: 768px) calc(33vw - 32px), calc(50vw - 24px)";
  return (
    <ul
      role="list"
      className={cn("grid grid-cols-2 gap-x-shop-grid gap-y-shop-grid-y sm:gap-x-shop-grid-sm md:grid-cols-3 lg:gap-x-shop-grid-lg", columns === 4 && "lg:grid-cols-4", className)}
    >
      {products.map((p, i) => (
        <li key={p.id} className="flex">
          <ProductCard
            product={p}
            display={display}
            showStockCode={showStockCode}
            wishlistSlot={wishlistSlot?.(p)}
            priority={i < priorityCount}
            headingLevel={headingLevel}
            sizes={sizes}
            locale={locale}
            className="w-full"
          />
        </li>
      ))}
    </ul>
  );
}
