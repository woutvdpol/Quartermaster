"use client";

import { RouteError } from "../pages/_components/RouteError";
import { copy } from "./_copy";

export default function MenusError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} crumb={copy.crumb} title={copy.title} />;
}
