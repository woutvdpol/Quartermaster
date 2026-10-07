import { Card, PageHeader, Skeleton, SkeletonText } from "@/components/admin/ui";
import { copy } from "../_copy";

export default function Loading() {
  return (
    <>
      <PageHeader crumb={copy.editor.crumb} title="Loading…" />
      <div role="status" aria-label="Loading page editor" className="grid content-start gap-4 p-4 md:px-[22px] md:py-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="grid content-start gap-4">
          <Card title={copy.editor.settings}>
            <div className="grid gap-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </Card>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" rounded="card" />
          ))}
        </div>
        <Card title={copy.editor.preview}>
          <SkeletonText lines={8} />
        </Card>
      </div>
    </>
  );
}
