import { DataTableSkeleton, PageHeader } from "@/components/admin/ui";

export default function Loading() {
  return (
    <>
      <PageHeader crumb="System" title="Audit log" />
      <div className="p-4 md:px-[22px] md:py-5">
        <DataTableSkeleton columns={3} rows={8} toolbar label="Loading audit log" />
      </div>
    </>
  );
}
