import { DataTableSkeleton, PageHeader } from "@/components/admin/ui";
import { auctionsCopy as t } from "./_copy";

export default function AuctionsLoading() {
  return (
    <>
      <PageHeader crumb={t.crumb} title={t.title} />
      <div className="p-4 md:px-[22px] md:py-5">
        <DataTableSkeleton columns={8} rows={6} label="Loading auctions" />
      </div>
    </>
  );
}
