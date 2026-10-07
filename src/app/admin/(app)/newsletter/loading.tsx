import { DataTableSkeleton, PageHeader, Skeleton } from "@/components/admin/ui";
import { copy } from "./_copy";

export default function Loading() {
  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[92px]" rounded="card" />
          ))}
        </div>
        <DataTableSkeleton columns={6} rows={6} label="Loading newsletter" />
      </div>
    </>
  );
}
