"use client";

import { useEffect, useRef } from "react";
import { ActionMessage, ActionToast, FormActions, SubmitButton, Textarea, useActionForm } from "@/components/admin/ui";
import { orderCopy } from "../../_copy";
import { addNoteAction } from "../actions";

const t = orderCopy.note;

/** Internal note → order timeline. Clears itself after a successful save. */
export function NoteForm({ orderId }: { orderId: string }) {
  const { state, formAction, error } = useActionForm(addNoteAction);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-3" noValidate>
      <input type="hidden" name="id" value={orderId} />
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <Textarea label={t.label} name="note" rows={3} hint={t.hint} maxLength={5000} error={error("note")} />
      <FormActions>
        <SubmitButton size="sm">{t.submit}</SubmitButton>
      </FormActions>
    </form>
  );
}
