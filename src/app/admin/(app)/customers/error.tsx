"use client";

import { RouteError } from "../orders/_components/RouteError";
import { customersCopy as t } from "./_copy";

export default function CustomersError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      error={error}
      retry={retry}
      crumb={t.crumb}
      title={t.title}
      heading={t.error.title}
      body={t.error.body}
      retryLabel={t.error.retry}
    />
  );
}
