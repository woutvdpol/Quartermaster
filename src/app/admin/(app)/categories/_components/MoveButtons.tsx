"use client";

import { useTransition } from "react";
import { cx, toast } from "@/components/admin/ui";
import { copy } from "../_copy";
import { moveCategoryAction } from "../actions";

const t = copy.categories;

const btn =
  "grid size-7 place-items-center rounded-control border border-transparent text-muted hover:border-line hover:bg-panel-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30";

/** Up / down within the siblings (no drag library; keyboard and screen-reader friendly). */
export function MoveButtons({
  id,
  title,
  parentId,
  index,
  siblingCount,
}: {
  id: string;
  title: string;
  parentId: string | null;
  /** Position among its siblings (0-based). */
  index: number;
  siblingCount: number;
}) {
  const [pending, startTransition] = useTransition();

  function move(to: number) {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("parentId", parentId ?? "");
    fd.set("index", String(to));
    startTransition(async () => {
      const res = await moveCategoryAction(fd);
      if (!res.ok) toast.crit(res.message ?? copy.result.failed);
    });
  }

  return (
    <span className={cx("inline-flex", pending && "opacity-60")} aria-busy={pending || undefined}>
      <button type="button" className={btn} aria-label={t.moveUp(title)} disabled={pending || index === 0} onClick={() => move(index - 1)}>
        <span aria-hidden="true">↑</span>
      </button>
      <button
        type="button"
        className={btn}
        aria-label={t.moveDown(title)}
        disabled={pending || index >= siblingCount - 1}
        onClick={() => move(index + 1)}
      >
        <span aria-hidden="true">↓</span>
      </button>
    </span>
  );
}
