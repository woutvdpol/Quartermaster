import { DataTableSkeleton, PageHeader } from "@/components/admin/ui";
import { offersCopy as t } from "./_copy";

export default function OffersLoading() {
  return (
    <>
      <PageHeader crumb={t.crumb} title={t.title} />
      <div className="p-4 md:px-[22px] md:py-5">
        <DataTableSkeleton columns={7} rows={10} label="Loading offers" />
      </div>
    </>
  );
}
