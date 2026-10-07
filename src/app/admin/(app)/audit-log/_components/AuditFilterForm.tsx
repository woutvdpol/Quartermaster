import Link from "next/link";
import { Button, DateInput, Select, buttonClasses } from "@/components/admin/ui";
import { ACTION_PREFIXES, ENTITIES, type AuditFilters } from "../_shared";

/** GET form for the audit filters (works without JavaScript; the URL holds the state). */
export function AuditFilterForm({
  basePath,
  filters,
  extra,
}: {
  basePath: string;
  filters: AuditFilters;
  /** Extra controls (e.g. the platform scope select). */
  extra?: React.ReactNode;
}) {
  const active = Boolean(filters.action || filters.entity || filters.from || filters.to);
  return (
    <form method="get" action={basePath} className="flex flex-wrap items-end gap-2.5 rounded-card border border-line bg-panel p-3 shadow-card" role="search" aria-label="Filter audit log">
      {extra}
      <div className="w-48">
        <Select label="Area" name="action" options={ACTION_PREFIXES} placeholder="All areas" defaultValue={filters.action ?? ""} />
      </div>
      <div className="w-44">
        <Select label="Entity" name="entity" options={ENTITIES} placeholder="All entities" defaultValue={filters.entity ?? ""} />
      </div>
      <div className="w-40">
        <DateInput label="From" name="from" defaultValue={filters.from ?? ""} />
      </div>
      <div className="w-40">
        <DateInput label="To" name="to" defaultValue={filters.to ?? ""} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          Apply
        </Button>
        {active && (
          <Link href={basePath} className={buttonClasses({ variant: "ghost" })}>
            Clear
          </Link>
        )}
      </div>
    </form>
  );
}
