import { PageHeader, Skeleton } from "@/components/admin/ui";
import { copy } from "./_copy";
import { CardSkeleton, KpiSkeleton, ListSkeleton } from "./_components/skeletons";

export default function DashboardLoading() {
  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} actions={<Skeleton className="h-8 w-56" />} />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <KpiSkeleton />
        <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
          <CardSkeleton title={copy.chart.title} height="h-56" />
          <ListSkeleton title={copy.todo.title} lines={6} />
        </div>
      </div>
    </>
  );
}
