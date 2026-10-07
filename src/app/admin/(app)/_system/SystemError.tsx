"use client";

import { useEffect } from "react";
import { Button, Card, PageHeader } from "@/components/admin/ui";

/** Friendly error state for the system screens' error.tsx boundaries. */
export function SystemError({ title, error, retry }: { title: string; error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const forbidden = error.message === "FORBIDDEN";
  return (
    <>
      <PageHeader crumb="System" title={title} />
      <div className="p-4 md:px-[22px] md:py-5">
        <Card title={forbidden ? "No access" : "This page could not be loaded"} className="max-w-xl">
          <div className="grid gap-3 text-[13.5px] text-ink-2">
            <p>
              {forbidden
                ? "Your account is not allowed to open this page, or no shop is selected."
                : "Something went wrong while loading this page. Your data is safe. Try again, and if it keeps happening, contact Quartermaster support."}
            </p>
            {error.digest && <p className="font-mono text-xs text-muted">Reference: {error.digest}</p>}
            <div>
              <Button variant="primary" onClick={() => retry()}>
                Try again
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
