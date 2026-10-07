"use client";

import { ConfirmDialog, cx, useSelection } from "@/components/admin/ui";
import { copy } from "../_copy";
import { deleteSubscribersAction } from "../actions";

const t = copy.subscribers;

/*
 * Design A dark bulk bar for the subscriber table. The kit's BulkActionBar wraps its children in a
 * <form>, which would nest the ConfirmDialog's form, so this renders the same bar (inside the
 * DataTable toolbar, which shares the table's selection state) and lets the dialog submit the ids.
 */
export function SubscriberBulkBar() {
  const { selected, clear } = useSelection();
  const ids = [...selected];
  const count = ids.length;

  async function remove(formData: FormData) {
    const result = await deleteSubscribersAction(formData);
    if (result.ok) clear();
    return result;
  }

  return (
    <div aria-live="polite">
      {count > 0 && (
        <div
          role="toolbar"
          aria-label={t.bulkLabel}
          className="flex flex-wrap items-center gap-2.5 bg-rail px-3.5 py-2 text-[13px] text-rail-ink"
        >
          <span className="font-medium">{t.selected(count)}</span>
          <div
            className={cx(
              "flex flex-wrap items-center gap-2",
              "[&>button]:border-rail-active [&>button]:bg-rail-active [&>button]:text-rail-ink [&>button:hover]:bg-rail-raised",
            )}
          >
            <ConfirmDialog
              trigger={t.delete}
              triggerSize="sm"
              tone="danger"
              title={t.deleteTitle(count)}
              description={t.deleteBody}
              confirmLabel={t.deleteConfirm}
              action={remove}
            >
              {ids.map((id) => (
                <input key={id} type="hidden" name="ids" value={id} />
              ))}
            </ConfirmDialog>
          </div>
          <button
            type="button"
            onClick={clear}
            className="ml-auto rounded-control border border-rail-active px-2.5 py-1 text-xs hover:bg-rail-raised"
          >
            {t.clear}
          </button>
        </div>
      )}
    </div>
  );
}
