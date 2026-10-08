import { cn } from "./cn";

/** Pulsing placeholder block. Size it with classes (h-4 w-32, aspect-square …). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-shop-sm bg-shop-sunken", className)} />;
}

/** Skeleton for a ProductGrid while products stream in. */
export function ProductGridSkeleton({ count = 8, columns = 4 }: { count?: number; columns?: 3 | 4 }) {
  return (
    <div className={cn("grid grid-cols-2 gap-x-4 gap-y-9 sm:gap-x-6 lg:gap-x-8", columns === 4 ? "md:grid-cols-3 lg:grid-cols-4" : "md:grid-cols-3")} aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="aspect-[4/5] w-full" />
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ))}
    </div>
  );
}

/**
 * Placeholder for the CATEGORIES block (src/components/shop/blocks/ShopBlocks.tsx): same rail/grid
 * geometry (square tile + two text lines), so the streamed-in block does not shift the page (CLS).
 */
export function CategoryTilesSkeleton({ heading = false }: { heading?: boolean }) {
  return (
    <div aria-busy="true">
      {heading ? <Skeleton className="mb-6 h-8 w-56 max-w-full sm:mb-8" /> : null}
      <div className="grid auto-cols-[42%] grid-flow-col gap-3 overflow-hidden pb-2 sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-3 sm:pb-0 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={cn("flex flex-col gap-2.5", i === 3 && "sm:hidden md:flex", i > 3 && "sm:hidden lg:flex")}>
            <Skeleton className="aspect-square w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
