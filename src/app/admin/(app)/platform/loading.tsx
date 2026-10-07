import { DataTableSkeleton, PageHeader } from "@/components/admin/ui";

export default function Loading() {
  return (
    <>
      <PageHeader crumb="Platform" title="Shops" />
      <div className="p-4 md:px-[22px] md:py-5">
        <DataTableSkeleton columns={6} rows={5} toolbar label="Loading shops" />
      </div>
    </>
  );
}
