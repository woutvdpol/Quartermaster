import { DataTableSkeleton, PageHeader } from "@/components/admin/ui";
import { copy } from "./_copy";

export default function ComplianceLoading() {
  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <div className="grid content-start gap-3 p-4 md:px-[22px] md:py-5">
        <DataTableSkeleton columns={5} rows={4} label={copy.loading} />
      </div>
    </>
  );
}
