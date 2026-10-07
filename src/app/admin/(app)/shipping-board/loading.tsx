import { PageHeader, Skeleton } from "@/components/admin/ui";
import { boardCopy as t } from "./_copy";

export default function ShippingBoardLoading() {
  return (
    <>
      <PageHeader crumb={t.crumb} title={t.title} />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading shipping board"
        className="grid content-start gap-4 p-4 md:px-[22px] md:py-5"
      >
        <Skeleton className="h-14" rounded="card" />
        <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="grid gap-2 rounded-card border border-line bg-panel p-2.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
