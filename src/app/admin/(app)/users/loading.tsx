import { DataTableSkeleton, PageHeader } from "@/components/admin/ui";

export default function Loading() {
  return (
    <>
      <PageHeader crumb="System" title="Users" />
      <div className="p-4 md:px-[22px] md:py-5">
        <DataTableSkeleton columns={5} rows={4} label="Loading users" />
      </div>
    </>
  );
}
