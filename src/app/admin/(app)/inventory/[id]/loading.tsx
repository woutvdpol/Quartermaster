import { Card, Skeleton, SkeletonText } from "@/components/admin/ui";

/** Skeleton for the product editor (header + main column + 300px side column). */
export default function Loading() {
  return (
    <div className="flex min-w-0 flex-1 flex-col" aria-busy="true" aria-label="Loading product">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3.5 md:px-[22px]">
        <div className="grid gap-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-6 w-72" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
      <div className="grid items-start gap-4 p-4 md:p-[22px] lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-4">
          <Card title="Photos">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <Skeleton className="col-span-2 row-span-2 aspect-square" />
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="aspect-square" />
              ))}
            </div>
          </Card>
          <Card title="Description">
            <div className="grid gap-3">
              <Skeleton className="h-9 w-full" />
              <SkeletonText lines={6} />
            </div>
          </Card>
        </div>
        <div className="grid gap-4">
          {["Status", "Price & stock", "Visibility", "Search engine"].map((title) => (
            <Card key={title} title={title}>
              <SkeletonText lines={3} />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
