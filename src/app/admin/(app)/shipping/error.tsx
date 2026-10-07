"use client";

import { SystemError } from "../_system/SystemError";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <SystemError title="Shipping" error={error} retry={retry} />;
}
