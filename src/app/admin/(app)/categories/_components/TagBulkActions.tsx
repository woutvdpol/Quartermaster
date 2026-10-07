"use client";

import { ConfirmDialog, Select } from "@/components/admin/ui";
import { IdFields, SelectionBar } from "../../inventory/_components/SelectionBar";
import { copy } from "../_copy";
import { deleteTagsAction, mergeTagsAction } from "../actions";

const t = copy.tags;

/** Merge / delete for the selected tags (inside the tags DataTable's SelectionProvider). */
export function TagBulkActions({ tags }: { tags: Array<{ id: string; name: string; productCount: number }> }) {
  const byId = new Map(tags.map((tg) => [tg.id, tg]));
  return (
    <SelectionBar label={t.bulkLabel} selectedLabel={t.selected} clearLabel={t.clear} escHint={t.escHint}>
      {(ids) => {
        // Suggest the selected tag with the most products as the one to keep.
        const suggested = [...ids].sort((a, b) => (byId.get(b)?.productCount ?? 0) - (byId.get(a)?.productCount ?? 0))[0];
        const selectedOptions = ids.flatMap((id) => {
          const tg = byId.get(id);
          return tg ? [{ value: tg.id, label: `${tg.name} (${tg.productCount})` }] : [];
        });
        const otherOptions = tags.filter((tg) => !ids.includes(tg.id)).map((tg) => ({ value: tg.id, label: `${tg.name} (${tg.productCount})` }));
        return (
          <>
            <ConfirmDialog
              key={`merge-${ids.join(",")}`}
              trigger={t.merge}
              triggerSize="sm"
              tone="primary"
              title={t.mergeTitle(ids.length)}
              description={t.mergeBody}
              confirmLabel={t.mergeConfirm}
              action={mergeTagsAction}
            >
              <IdFields ids={ids} />
              <Select
                label={t.mergeTarget}
                name="targetId"
                required
                defaultValue={suggested}
                options={[
                  { label: "Selected", options: selectedOptions },
                  ...(otherOptions.length ? [{ label: "Other tags", options: otherOptions }] : []),
                ]}
              />
            </ConfirmDialog>
            <ConfirmDialog
              trigger={t.delete}
              triggerSize="sm"
              title={t.deleteTitle(ids.length)}
              description={t.deleteBody}
              confirmLabel={t.deleteConfirm}
              action={deleteTagsAction}
            >
              <IdFields ids={ids} />
            </ConfirmDialog>
          </>
        );
      }}
    </SelectionBar>
  );
}
