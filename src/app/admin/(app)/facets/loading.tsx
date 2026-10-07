import { PageHeader, Skeleton } from "@/components/admin/ui";
import { copy } from "./_copy";

export default function FacetsLoading() {
  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <div role="status" aria-busy="true" aria-label={copy.loading} className="grid content-start gap-4 p-4 md:px-[22px] md:py-5 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        {[6, 10].map((rows, c) => (
          <div key={c} className="overflow-hidden rounded-card border border-line bg-panel shadow-card">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="ml-auto h-3.5 w-16" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
