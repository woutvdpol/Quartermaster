import type { ReactNode } from "react";
import { cx } from "./cx";

type FormActionsProps = {
  children: ReactNode;
  /** Left-hand content, e.g. "Last saved 2 minutes ago" or a delete button. */
  start?: ReactNode;
  /** Stick to the bottom of the viewport (long editors). */
  sticky?: boolean;
  className?: string;
};

/** Bar with the form's buttons (primary last). */
export function FormActions({ children, start, sticky = false, className }: FormActionsProps) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3.5",
        sticky && "sticky bottom-0 z-10 -mx-4 bg-panel px-4 pb-3.5 md:-mx-[22px] md:px-[22px]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted">{start}</div>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
