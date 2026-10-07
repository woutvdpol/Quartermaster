import { PageHeader, Skeleton, SkeletonText } from "@/components/admin/ui";

/** Loading state shared by the system screens: header + a few card placeholders. */
export function SystemPageSkeleton({ crumb, title, cards = 2, aside = false }: { crumb: string; title: string; cards?: number; aside?: boolean }) {
  return (
    <>
      <PageHeader crumb={crumb} title={title} />
      <div
        aria-busy="true"
        aria-label={`Loading ${title}`}
        className={`grid content-start gap-4 p-4 md:px-[22px] md:py-5 ${aside ? "md:grid-cols-[200px_minmax(0,1fr)]" : ""}`}
      >
        {aside && (
          <div className="grid content-start gap-1.5">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        )}
        <div className="grid content-start gap-4">
          {Array.from({ length: cards }, (_, i) => (
            <div key={i} className="grid gap-3 rounded-card border border-line bg-panel p-3.5 shadow-card">
              <Skeleton className="h-4 w-40" />
              <SkeletonText lines={4} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
