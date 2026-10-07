import { DataTableSkeleton, PageHeader } from "@/components/admin/ui";
import { copy } from "./_copy";

export default function SourcingLoading() {
  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <DataTableSkeleton columns={6} rows={8} toolbar label={copy.title} />
      </div>
    </>
  );
}
