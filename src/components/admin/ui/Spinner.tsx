import { cx } from "./cx";

/** Small inline spinner using currentColor. Static under prefers-reduced-motion. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx(
        "inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent",
        className,
      )}
    />
  );
}
