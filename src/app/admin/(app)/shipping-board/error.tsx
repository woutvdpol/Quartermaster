"use client";

import { RouteError } from "../orders/_components/RouteError";
import { boardCopy as t } from "./_copy";

export default function ShippingBoardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <RouteError
      error={error}
      retry={retry}
      crumb={t.crumb}
      title={t.title}
      heading="The shipping board couldn't be loaded"
      body="Something went wrong while loading orders. Try again; if it keeps happening, check the server log."
    />
  );
}
