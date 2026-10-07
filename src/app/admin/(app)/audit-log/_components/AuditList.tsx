"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, DateTime, EmptyState, thClass, tdClass, toast, type ActionResult } from "@/components/admin/ui";
import type { AuditFilters, AuditRow } from "../_shared";

type LoadMore = (
  filters: AuditFilters,
  cursor: string,
) => Promise<ActionResult<string, { rows: AuditRow[]; nextCursor: string | null }>>;

/** Audit entries with "Load more" (keyset pagination, appends in place). */
export function AuditList({
  initialRows,
  initialCursor,
  filters,
  loadMore,
  timeZone,
  showTenant = false,
  tenantNames = {},
  emptyBody,
}: {
  initialRows: AuditRow[];
  initialCursor: string | null;
  filters: AuditFilters;
  loadMore: LoadMore;
  timeZone?: string;
  showTenant?: boolean;
  tenantNames?: Record<string, string>;
  emptyBody?: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, start] = useTransition();

  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-line bg-panel shadow-card">
        <EmptyState compact title="No entries" body={emptyBody ?? "Nothing matches these filters. Try a wider date range or clear the filters."} />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto rounded-card border border-line bg-panel shadow-card">
        <table className="w-full text-[13px]">
          <caption className="sr-only">Audit log entries, newest first</caption>
          <thead className="border-b border-line bg-panel-2">
            <tr>
              <th scope="col" className={thClass}>Time</th>
              {showTenant && <th scope="col" className={thClass}>Shop</th>}
              <th scope="col" className={thClass}>Who</th>
              <th scope="col" className={thClass}>What</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line align-top last:border-b-0">
                <td className={`${tdClass} align-top whitespace-nowrap font-mono text-[12px] text-ink-2`}>
                  <DateTime value={r.createdAt} timeZone={timeZone} />
                </td>
                {showTenant && <td className={`${tdClass} align-top text-ink-2`}>{r.tenantId ? (tenantNames[r.tenantId] ?? r.tenantId) : <span className="text-muted">Platform</span>}</td>}
                <td className={`${tdClass} align-top`}>
                  <span className="break-all">{r.actor}</span>
                  {r.ip && <span className="block font-mono text-[11.5px] text-muted">{r.ip}</span>}
                </td>
                <td className={`${tdClass} align-top`}>
                  <p>{r.summary}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
                    <span className="font-mono">{r.action}</span>
                    {r.entity && (
                      <>
                        <span aria-hidden="true">·</span>
                        {r.href ? (
                          <Link href={r.href} className="text-accent underline-offset-2 hover:underline">
                            {r.entity}
                            {r.entityId ? ` ${r.entityId.length > 14 ? `${r.entityId.slice(0, 12)}…` : r.entityId}` : ""}
                          </Link>
                        ) : (
                          <span>
                            {r.entity}
                            {r.entityId ? ` ${r.entityId.length > 14 ? `${r.entityId.slice(0, 12)}…` : r.entityId}` : ""}
                          </span>
                        )}
                      </>
                    )}
                  </p>
                  {r.details && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11.5px] text-muted">Details</summary>
                      <pre className="mt-1 max-h-60 max-w-[70ch] overflow-auto rounded-control bg-panel-2 p-2 font-mono text-[11.5px] whitespace-pre-wrap text-ink-2">{r.details}</pre>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span aria-live="polite">{rows.length} entries shown</span>
        {cursor ? (
          <Button
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={() =>
              start(async () => {
                const res = await loadMore(filters, cursor);
                if (!res.ok || !res.data) {
                  toast.crit(res.message ?? "Could not load more entries.");
                  return;
                }
                const more = res.data.rows;
                setRows((rs) => [...rs, ...more]);
                setCursor(res.data.nextCursor);
              })
            }
          >
            {pending ? "Loading…" : "Load more"}
          </Button>
        ) : (
          <span>End of the log</span>
        )}
      </div>
    </div>
  );
}
