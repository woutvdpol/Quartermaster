import type { ReactNode } from "react";
import { cx } from "./cx";

export type TimelineItem = {
  id?: string;
  title: ReactNode;
  /** Mono meta line under the title: time, actor ("07-10 14:02 · Mollie webhook"). */
  meta?: ReactNode;
  body?: ReactNode;
  /** Key event: brass dot (design A `.tl .k`). */
  highlight?: boolean;
  tone?: "ok" | "warn" | "crit" | "info";
};

const dotTone = { ok: "bg-ok", warn: "bg-warn", crit: "bg-crit", info: "bg-info" };

/** Vertical event history (order timeline, audit trail), newest first by convention. */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cx("grid gap-3 text-[13px]", className)}>
      {items.map((item, i) => (
        <li key={item.id ?? i} className="grid grid-cols-[12px_1fr] gap-2.5">
          <span
            aria-hidden="true"
            className={cx(
              "mt-[5px] size-[9px] rounded-full",
              item.tone ? dotTone[item.tone] : item.highlight ? "bg-accent" : "bg-line-strong",
            )}
          />
          <div className="min-w-0">
            <div className={item.highlight ? "font-medium" : undefined}>{item.title}</div>
            {item.meta && <div className="font-mono text-[11.5px] text-muted">{item.meta}</div>}
            {item.body && <div className="mt-1 text-ink-2">{item.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
