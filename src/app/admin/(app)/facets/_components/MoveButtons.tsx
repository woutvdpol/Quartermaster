"use client";

import { useTransition } from "react";
import { cx, toast } from "@/components/admin/ui";
import { copy } from "../_copy";
import { moveFacetAction, moveValueAction } from "../actions";

const btn =
  "grid size-7 place-items-center rounded-control border border-transparent text-muted hover:border-line hover:bg-panel-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30";

/** Up / down among siblings (facets: the facet order; values: siblings under the same parent). */
export function MoveButtons({
  kind,
  id,
  parentId = null,
  index,
  count,
  upLabel,
  downLabel,
}: {
  kind: "facet" | "value";
  id: string;
  parentId?: string | null;
  index: number;
  count: number;
  upLabel: string;
  downLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  function move(to: number) {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("index", String(to));
    if (kind === "value") fd.set("parentId", parentId ?? "");
    startTransition(async () => {
      const res = await (kind === "facet" ? moveFacetAction(fd) : moveValueAction(fd));
      if (!res.ok) toast.crit(res.message ?? copy.result.failed);
    });
  }
  return (
    <span className={cx("inline-flex", pending && "opacity-60")} aria-busy={pending || undefined}>
      <button type="button" className={btn} aria-label={upLabel} disabled={pending || index === 0} onClick={() => move(index - 1)}>
        <span aria-hidden="true">↑</span>
      </button>
      <button type="button" className={btn} aria-label={downLabel} disabled={pending || index >= count - 1} onClick={() => move(index + 1)}>
        <span aria-hidden="true">↓</span>
      </button>
    </span>
  );
}
