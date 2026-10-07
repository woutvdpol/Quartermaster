"use client";

import { SystemError } from "../_system/SystemError";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <SystemError title="Audit log" error={error} retry={retry} />;
}
