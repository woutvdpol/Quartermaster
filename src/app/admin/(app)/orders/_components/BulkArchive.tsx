"use client";

import { ConfirmDialog, useSelection } from "@/components/admin/ui";
import { ordersCopy as t } from "../_copy";
import { archiveOrdersAction } from "../actions";

/** Bulk-bar button: archives the selected orders after confirmation. */
export function BulkArchive() {
  const { selected, clear } = useSelection();
  const ids = [...selected];
  return (
    <ConfirmDialog
      trigger={t.bulk.archive}
      triggerSize="sm"
      triggerVariant="secondary"
      title={t.bulk.title(ids.length)}
      description={t.bulk.description}
      confirmLabel={t.bulk.confirm}
      action={async (formData: FormData) => {
        const result = await archiveOrdersAction(formData);
        if (result.ok) clear();
        return result;
      }}
    >
      {ids.map((id) => (
        <input key={id} type="hidden" name="ids" value={id} />
      ))}
    </ConfirmDialog>
  );
}
