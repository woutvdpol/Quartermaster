import { DataTableSkeleton, PageHeader } from "@/components/admin/ui";
import { copy } from "./_copy";

export default function Loading() {
  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <div className="p-4 md:px-[22px] md:py-5">
        <DataTableSkeleton columns={6} rows={6} label="Loading pages" />
      </div>
    </>
  );
}
