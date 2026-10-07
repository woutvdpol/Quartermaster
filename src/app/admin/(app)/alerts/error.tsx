"use client";

import { useEffect } from "react";
import { Button, Card, PageHeader } from "@/components/admin/ui";
import { copy } from "./_copy";

export default function AlertsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <div className="p-4 md:px-[22px] md:py-5">
        <Card title="Something went wrong" className="max-w-xl">
          <p className="text-[13.5px] text-ink-2">
            The alerts could not be loaded. Try again; if it keeps failing, reload the page.
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
