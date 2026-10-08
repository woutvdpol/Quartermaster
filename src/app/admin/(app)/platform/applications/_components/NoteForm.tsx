"use client";

import { ActionMessage, ActionToast, FormActions, SubmitButton, Textarea, useActionForm } from "@/components/admin/ui";
import { saveApplicationNoteAction } from "../actions";

/** Internal note on an application (only visible to platform admins). */
export function NoteForm({ id, note }: { id: string; note: string | null }) {
  const { state, formAction, error } = useActionForm(saveApplicationNoteAction);
  return (
    <form action={formAction} className="grid gap-2" noValidate>
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <input type="hidden" name="id" value={id} />
      <Textarea label="Internal note" name="note" rows={3} defaultValue={note ?? ""} maxLength={5000} error={error("note")} hint="Only visible to platform admins." />
      <FormActions>
        <SubmitButton size="sm">Save note</SubmitButton>
      </FormActions>
    </form>
  );
}
