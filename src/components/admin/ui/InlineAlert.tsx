import type { ReactNode } from "react";
import { cx } from "./cx";

export type AlertTone = "info" | "ok" | "warn" | "crit";

const tones: Record<AlertTone, { box: string; icon: string; mark: string }> = {
  info: { box: "border-info/40 bg-info-soft", icon: "text-info", mark: "i" },
  ok: { box: "border-ok/40 bg-ok-soft", icon: "text-ok", mark: "✓" },
  warn: { box: "border-warn/50 bg-warn-soft", icon: "text-warn", mark: "!" },
  crit: { box: "border-crit/50 bg-crit-soft", icon: "text-crit", mark: "!" },
};

type InlineAlertProps = {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons/links on the right. */
  action?: ReactNode;
  /**
   * Live-region role. "alert" for errors that appear after an action, "status" for success
   * messages that appear dynamically, "none" for static page notes (default).
   */
  live?: "alert" | "status" | "none";
  className?: string;
  id?: string;
};

/** Message box in the page flow (form errors, notices). Text carries meaning; colour reinforces. */
export function InlineAlert({ tone = "info", title, children, action, live = "none", className, id }: InlineAlertProps) {
  const style = tones[tone];
  return (
    <div
      id={id}
      role={live === "none" ? undefined : live}
      className={cx("flex items-start gap-2.5 rounded-card border px-3.5 py-2.5 text-[13px] text-ink", style.box, className)}
    >
      <span
        aria-hidden="true"
        className={cx("mt-px grid size-[18px] shrink-0 place-items-center rounded-full border border-current font-mono text-[11px] font-semibold", style.icon)}
      >
        {style.mark}
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink-2">{children}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/**
 * Shows an ActionResult message (from useActionState) as an InlineAlert, or nothing.
 * Pass `showSuccess={false}` when success is reported with a toast instead.
 */
export function ActionMessage({
  state,
  showSuccess = true,
  className,
}: {
  state: { ok: boolean; message?: string } | null | undefined;
  showSuccess?: boolean;
  className?: string;
}) {
  if (!state?.message || (state.ok && !showSuccess)) return null;
  return (
    <InlineAlert tone={state.ok ? "ok" : "crit"} live={state.ok ? "status" : "alert"} className={className}>
      {state.message}
    </InlineAlert>
  );
}
