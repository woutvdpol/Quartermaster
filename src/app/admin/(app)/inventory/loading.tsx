import { DataTableSkeleton, PageHeader, Skeleton } from "@/components/admin/ui";
import { copy } from "./_copy";

export default function InventoryLoading() {
  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <div className="grid content-start gap-3 p-4 md:px-[22px] md:py-5">
        <Skeleton className="h-5 w-96 max-w-full" />
        <DataTableSkeleton columns={7} rows={10} selectable label={copy.loading} />
      </div>
    </>
  );
}
