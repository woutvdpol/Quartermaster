import { PageHeader, Skeleton, SkeletonText } from "@/components/admin/ui";
import { copy } from "../../_copy";

export default function Loading() {
  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <div
        className="grid items-start gap-4 p-4 md:px-[22px] md:py-5 lg:grid-cols-2"
        aria-busy="true"
        aria-label="Loading campaign"
      >
        <div className="grid gap-3 rounded-card border border-line bg-panel p-3.5 shadow-card">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-72 w-full" />
          <SkeletonText lines={2} />
        </div>
        <Skeleton className="h-[600px] w-full" rounded="card" />
      </div>
    </>
  );
}
