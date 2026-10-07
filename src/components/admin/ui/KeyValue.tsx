import type { ReactNode } from "react";
import { cx } from "./cx";

export type KeyValueItem = { label: ReactNode; value: ReactNode; mono?: boolean };

type KeyValueProps = {
  items: KeyValueItem[];
  /** "split": labels left, values right (design A `.kv`); "stacked": label above value. */
  layout?: "split" | "stacked";
  className?: string;
};

/** Definition list for record details (order summary, product facts). */
export function KeyValue({ items, layout = "split", className }: KeyValueProps) {
  if (layout === "stacked") {
    return (
      <dl className={cx("grid gap-3 text-[13px] sm:grid-cols-2", className)}>
        {items.map((item, i) => (
          <div key={i} className="grid gap-0.5">
            <dt className="type-label text-[11px] text-muted">{item.label}</dt>
            <dd className={cx("m-0", item.mono && "font-mono tabular-nums")}>{item.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className={cx("grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]", className)}>
      {items.map((item, i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{item.label}</dt>
          <dd className={cx("m-0 text-right", item.mono && "font-mono tabular-nums")}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
