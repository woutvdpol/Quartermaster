import { PageHeader, Skeleton } from "@/components/admin/ui";
import { copy } from "./_copy";

export default function Loading() {
  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <div role="status" aria-label="Loading menus" className="grid max-w-4xl content-start gap-2 p-4 md:px-[22px] md:py-5">
        <Skeleton className="mb-2 h-8 w-64" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full" rounded="card" />
        ))}
      </div>
    </>
  );
}
