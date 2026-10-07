"use client";

import { useEffect } from "react";
import { Button, Card, PageHeader } from "@/components/admin/ui";

/** Friendly fallback for the content screens' error boundaries. */
export function RouteError({ error, retry, crumb, title }: { error: Error & { digest?: string }; retry: () => void; crumb: string; title: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <>
      <PageHeader crumb={crumb} title={title} />
      <div className="p-4 md:px-[22px] md:py-5">
        <Card title="Something went wrong" className="max-w-xl">
          <p className="text-[13.5px] text-ink-2">
            This screen could not be loaded. Try again; if it keeps failing, reload the page.
            {error.digest && <span className="mt-1 block font-mono text-xs text-muted">Reference: {error.digest}</span>}
          </p>
          <Button variant="primary" className="mt-4" onClick={() => retry()}>
            Try again
          </Button>
        </Card>
      </div>
    </>
  );
}
