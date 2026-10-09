"use client";

import Link from "next/link";
import { BulkActionBar, RowCheckbox, SelectAllCheckbox, SelectionProvider, toast } from "@/components/admin/ui";
import { ENTITY_LABELS, LOCALE_LABELS } from "@/server/translations/fields";
import type { ReviewRow } from "@/server/translations/service";
import { approveManyAction } from "../actions";
import { TranslationEditor } from "./TranslationEditor";

/** Review queue: one editor per translation, select several to approve the machine proposals as they are. */
export function ReviewList({ rows }: { rows: ReviewRow[] }) {
  const bulkApprove = async (formData: FormData) => {
    const res = await approveManyAction(null, formData);
    (res.ok ? toast.ok : toast.crit)(res.message ?? (res.ok ? "Approved." : "Could not approve."));
  };
  return (
    <SelectionProvider ids={rows.map((r) => r.id)}>
      <div className="grid gap-2">
        <div className="flex items-center gap-2 px-1 text-xs text-muted">
          <SelectAllCheckbox />
          <span>Select all on this page</span>
        </div>
        <BulkActionBar action={bulkApprove}>
          <button type="submit" className="rounded-control border px-2.5 py-1 text-xs">
            Approve as they are
          </button>
        </BulkActionBar>
        <ul className="grid gap-3">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-3 rounded-card border border-line bg-panel p-3.5 shadow-card">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                <RowCheckbox id={r.id} label={`${r.label} — ${r.fieldLabel} (${r.locale.toUpperCase()})`} />
                <span className="type-label text-[11px] text-muted">{ENTITY_LABELS[r.entity]}</span>
                {r.href ? (
                  <Link href={r.href} className="min-w-0 truncate font-medium text-ink hover:underline">
                    {r.label}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate font-medium text-ink">{r.label}</span>
                )}
                <span className="text-muted">
                  {r.fieldLabel} · {LOCALE_LABELS[r.locale]}
                </span>
              </div>
              <TranslationEditor
                cell={{ entity: r.entity, entityId: r.entityId, field: r.field, locale: r.locale }}
                fieldLabel={r.fieldLabel}
                source={r.source}
                markdown={r.markdown}
                status={r.status}
                value={r.value}
                stale={r.stale}
              />
            </li>
          ))}
        </ul>
      </div>
    </SelectionProvider>
  );
}
