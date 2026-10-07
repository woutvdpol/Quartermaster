import { Card, PageHeader, Skeleton, SkeletonText } from "@/components/admin/ui";
import { customerCopy as t } from "../_copy";

export default function CustomerLoading() {
  return (
    <>
      <PageHeader crumb={t.crumb} title="Customer" />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading customer"
        className="grid content-start gap-4 p-4 md:px-[22px] md:py-5"
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[86px]" rounded="card" />
          ))}
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Card title={t.orders.title}>
            <SkeletonText lines={6} />
          </Card>
          <Card title={t.profile.title}>
            <SkeletonText lines={5} />
          </Card>
        </div>
      </div>
    </>
  );
}
