import { Skeleton } from "@/components/shop/ui/Skeleton";

/** Placeholder while a session-dependent form streams in. */
export function FormSkeleton({ fields = 2 }: { fields?: number }) {
  return (
    <div className="grid gap-4" aria-busy="true">
      {Array.from({ length: fields }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
