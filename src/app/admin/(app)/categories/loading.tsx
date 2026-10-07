import { PageHeader, Skeleton } from "@/components/admin/ui";
import { copy } from "./_copy";

export default function CategoriesLoading() {
  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <div className="grid content-start gap-3 p-4 md:px-[22px] md:py-5">
        <div role="status" aria-busy="true" aria-label={copy.loading} className="grid gap-0 overflow-hidden rounded-card border border-line bg-panel shadow-card">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0" style={{ paddingLeft: `${0.875 + (i % 3) * 1.5}rem` }}>
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="ml-auto h-3.5 w-20" />
              <Skeleton className="h-6 w-14" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
