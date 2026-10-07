import type { ReactNode } from "react";
import { cx } from "./cx";

type EmptyStateProps = {
  title: ReactNode;
  body?: ReactNode;
  /** Primary next step, e.g. <Link className={buttonClasses({variant:"primary"})}>Add product</Link>. */
  action?: ReactNode;
  /** Small decorative mark above the title (defaults to a striped crate). */
  icon?: ReactNode;
  /** Less padding, for inside tables and cards. */
  compact?: boolean;
  className?: string;
};

export function EmptyState({ title, body, action, icon, compact = false, className }: EmptyStateProps) {
  return (
    <div className={cx("grid justify-items-center gap-2 text-center", compact ? "px-4 py-8" : "px-6 py-14", className)}>
      <div aria-hidden="true">
        {icon ?? (
          <span className="block size-10 rounded-[4px] border border-line [background:repeating-linear-gradient(135deg,var(--qm-img-a)_0_6px,var(--qm-img-b)_6px_12px)]" />
        )}
      </div>
      <p className="type-display text-lg text-ink">{title}</p>
      {body && <p className="max-w-[48ch] text-[13px] text-muted">{body}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
