import { Card, Skeleton, SkeletonText } from "@/components/admin/ui";

export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-card border border-line bg-panel p-3.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2 h-7 w-28" />
          <Skeleton className="mt-2 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ title, height = "h-48" }: { title: string; height?: string }) {
  return (
    <Card title={title}>
      <div aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`}>
        <Skeleton className={`${height} w-full`} />
      </div>
    </Card>
  );
}

export function ListSkeleton({ title, lines = 5 }: { title: string; lines?: number }) {
  return (
    <Card title={title}>
      <div aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`}>
        <SkeletonText lines={lines} />
      </div>
    </Card>
  );
}
