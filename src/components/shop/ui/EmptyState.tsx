import type { ReactNode } from "react";
import { cn } from "./cn";

/** Friendly "nothing here" panel with optional action (e.g. a ButtonLink). */
export function EmptyState({
  title,
  children,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center rounded-shop border border-dashed border-shop-line-strong bg-shop-surface/60 px-6 py-12 text-center", className)}>
      {icon ? <div className="mb-3 text-shop-muted" aria-hidden="true">{icon}</div> : null}
      <h2 className="text-xl text-shop-ink">{title}</h2>
      {children ? <div className="mt-2 max-w-md text-shop-muted">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
