"use client";

import { Button, EmptyState, PageHeader } from "@/components/admin/ui";
import { copy } from "./_copy";

export default function InsightsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <EmptyState
        title={copy.error.title}
        body={copy.error.body}
        action={
          <Button variant="primary" onClick={() => retry()}>
            {copy.error.retry}
          </Button>
        }
      />
    </>
  );
}
