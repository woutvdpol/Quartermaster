import { Card, PageHeader, Skeleton, SkeletonText } from "@/components/admin/ui";
import { orderCopy as t } from "../_copy";

export default function OrderLoading() {
  return (
    <>
      <PageHeader crumb={t.crumb} title="Order" />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading order"
        className="grid content-start gap-4 p-4 md:px-[22px] md:py-5"
      >
        <Card>
          <Skeleton className="h-6 w-3/4" />
        </Card>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="grid gap-4">
            <Card title={t.lines.title}>
              <SkeletonText lines={4} />
            </Card>
            <Card title={t.payments.title}>
              <SkeletonText lines={2} />
            </Card>
          </div>
          <div className="grid gap-4">
            <Card title={t.customer.title}>
              <SkeletonText lines={3} />
            </Card>
            <Card title={t.timeline.title}>
              <SkeletonText lines={5} />
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
