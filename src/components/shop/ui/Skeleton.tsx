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
