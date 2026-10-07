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
    <div className={cn("flex flex-col items-center rounded-shop bg-shop-sunken px-6 py-14 text-center sm:py-20", className)}>
      {icon ? (
        <div className="mb-4 grid size-12 place-items-center rounded-shop-control bg-shop-surface text-shop-muted" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h2 className="text-2xl text-shop-ink sm:text-[1.75rem]">{title}</h2>
      {children ? <div className="mt-2 max-w-md text-shop-ink-2">{children}</div> : null}
      {action ? <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
