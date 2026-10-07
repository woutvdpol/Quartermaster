import { Card, PageHeader, Skeleton, SkeletonText } from "@/components/admin/ui";
import { copy } from "../../_copy";

export default function PurchaseRecordLoading() {
  return (
    <>
      <PageHeader crumb={copy.detail.crumb} title={copy.detail.titleFallback} />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5 lg:grid-cols-[1fr_320px]" aria-busy="true">
        <Card title={copy.detail.products}>
          <Skeleton className="h-56 w-full" />
        </Card>
        <Card title={copy.detail.summary}>
          <SkeletonText lines={6} />
        </Card>
      </div>
    </>
  );
}
