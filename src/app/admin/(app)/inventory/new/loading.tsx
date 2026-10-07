import { Card, Skeleton } from "@/components/admin/ui";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="grid gap-1.5 border-b border-line bg-panel px-4 py-3.5 md:px-[22px]">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-6 w-48" />
      </div>
      <div className="p-4 md:p-[22px]">
        <Card className="max-w-xl">
          <div className="grid gap-4">
            <Skeleton className="h-9 w-full" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
            <Skeleton className="h-9 w-full" />
          </div>
        </Card>
      </div>
    </div>
  );
}
