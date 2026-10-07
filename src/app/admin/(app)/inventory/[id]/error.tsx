"use client";

import Link from "next/link";
import { Button, buttonClasses, EmptyState, PageHeader } from "@/components/admin/ui";
import { copy } from "./_copy";

/** Friendly error for the product editor; `retry` re-fetches and re-renders the segment. */
export default function ProductError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader crumb={copy.crumbInventory} title={copy.errors.loadTitle} />
      <div className="p-4 md:p-[22px]">
        <EmptyState
          title={copy.errors.loadTitle}
          body={
            <>
              {copy.errors.loadBody}
              {error.digest && <span className="mt-1 block font-mono text-xs text-muted">Ref: {error.digest}</span>}
            </>
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => retry()}>
                {copy.errors.retry}
              </Button>
              <Link href="/admin/inventory" className={buttonClasses()}>
                {copy.errors.back}
              </Link>
            </div>
          }
        />
      </div>
    </div>
  );
}
