"use client";

import { ordersCopy as t } from "./_copy";
import { RouteError } from "./_components/RouteError";

export default function OrdersError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
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
