"use client";

import { Button, InlineAlert, PageHeader } from "@/components/admin/ui";
import { copy } from "./_copy";

export default function ComplianceError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <div className="p-4 md:px-[22px] md:py-5">
        <InlineAlert tone="crit" live="alert" title={copy.error.title} action={<Button onClick={() => retry()}>{copy.error.retry}</Button>}>
          {copy.error.body}
        </InlineAlert>
      </div>
    </>
  );
}
