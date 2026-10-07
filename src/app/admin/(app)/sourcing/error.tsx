"use client";

import { Button, EmptyState, PageHeader } from "@/components/admin/ui";
import { copy } from "./_copy";

export default function SourcingError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <EmptyState
        title={copy.errors.loadTitle}
        body={copy.errors.loadBody}
        action={
          <Button variant="primary" onClick={() => retry()}>
            {copy.errors.retry}
          </Button>
        }
      />
    </>
  );
}
