import { DataTableSkeleton, PageHeader } from "@/components/admin/ui";

export default function Loading() {
  return (
    <>
      <PageHeader crumb="Platform" title="Dealer applications" />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <DataTableSkeleton columns={5} rows={6} label="Loading applications" />
      </div>
    </>
  );
}
