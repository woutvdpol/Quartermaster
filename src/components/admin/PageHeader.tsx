import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  crumb?: ReactNode;
  actions?: ReactNode;
};

/** The bar at the top of the work area: breadcrumb, page title and page-level actions. */
export function PageHeader({ title, crumb, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3.5 md:px-[22px]">
      <div className="min-w-0">
        {crumb && <div className="text-xs text-muted">{crumb}</div>}
        <h1 className="type-display text-[22px]">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
