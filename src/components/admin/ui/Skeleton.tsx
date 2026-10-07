import { cx } from "./cx";

/** Loading placeholder block. Decorative: announce loading elsewhere (e.g. aria-busy on the region). */
export function Skeleton({ className, rounded = "control" }: { className?: string; rounded?: "control" | "full" | "card" }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "block animate-pulse bg-panel-3",
        rounded === "full" ? "rounded-full" : rounded === "card" ? "rounded-card" : "rounded-control",
        className ?? "h-4 w-full",
      )}
    />
  );
}

/** A few lines of text-shaped skeletons; the last one shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cx("grid gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx("h-3", i === lines - 1 && lines > 1 ? "w-3/5" : "w-full")} />
      ))}
    </span>
  );
}
