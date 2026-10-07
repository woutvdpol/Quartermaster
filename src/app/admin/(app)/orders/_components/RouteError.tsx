"use client";

import { useEffect } from "react";
import { Button, Card, PageHeader } from "@/components/admin/ui";

/** Friendly error boundary body shared by the order, customer and shipping-board routes. */
export function RouteError({
  error,
  retry,
  crumb,
  title,
  heading,
  body,
  retryLabel = "Try again",
}: {
  error: Error & { digest?: string };
  retry: () => void;
  crumb: string;
  title: string;
  heading: string;
  body: string;
  retryLabel?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <PageHeader crumb={crumb} title={title} />
      <div className="p-4 md:px-[22px] md:py-5">
        <Card title={heading} className="max-w-xl">
          <div role="alert" className="grid gap-3 text-[13.5px] text-ink-2">
            <p>{body}</p>
            {error.digest && <p className="font-mono text-xs text-muted">Ref: {error.digest}</p>}
            <div>
              <Button variant="primary" onClick={() => retry()}>
                {retryLabel}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
