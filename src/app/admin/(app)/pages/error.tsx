"use client";

import { copy } from "./_copy";
import { RouteError } from "./_components/RouteError";

export default function PagesError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} crumb={copy.crumb} title={copy.title} />;
}
