import { DataTableSkeleton, PageHeader } from "@/components/admin/ui";
import { customersCopy as t } from "./_copy";

export default function CustomersLoading() {
  return (
    <>
      <PageHeader crumb={t.crumb} title={t.title} />
      <div className="p-4 md:px-[22px] md:py-5">
        <DataTableSkeleton columns={6} rows={10} label="Loading customers" />
      </div>
    </>
  );
}
