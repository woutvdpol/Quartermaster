"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/** Replace URL search params without a history entry; resets `page` unless it is in the patch. */
export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setParams(patch: Record<string, string | null | undefined>) {
    const next = new URLSearchParams(searchParams.toString());
    if (!("page" in patch)) next.delete("page");
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  return { searchParams, setParams, pending };
}
