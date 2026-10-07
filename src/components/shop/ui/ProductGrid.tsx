import type { ReactNode } from "react";
import { cn } from "./cn";
import { ProductCard } from "./ProductCard";
import type { DisplayCurrency, ProductCardData } from "./types";

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
}: {
  products: ProductCardData[];
  columns?: 3 | 4;
  display?: DisplayCurrency | null;
  showStockCode?: boolean;
  wishlistSlot?: (product: ProductCardData) => ReactNode;
  priorityCount?: number;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}) {
  const sizes = columns === 4 ? "(min-width: 1024px) 280px, (min-width: 768px) 33vw, 50vw" : "(min-width: 1024px) 380px, (min-width: 768px) 33vw, 50vw";
  return (
    <ul
      role="list"
      className={cn("grid grid-cols-2 gap-x-4 gap-y-9 sm:gap-x-6 md:grid-cols-3 lg:gap-x-8", columns === 4 && "lg:grid-cols-4", className)}
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
            className="w-full"
          />
        </li>
      ))}
    </ul>
  );
}
