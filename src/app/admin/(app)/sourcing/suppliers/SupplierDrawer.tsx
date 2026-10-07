"use client";

import { useState } from "react";
import {
  ActionMessage,
  ActionToast,
  Button,
  Drawer,
  Spinner,
  TextInput,
  Textarea,
  useActionForm,
  type ActionState,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/admin/ui";
import { copy } from "../_copy";
import { useNoResetSubmit } from "../_components/use-no-reset-submit";
import { saveSupplierAction } from "./actions";

type Props = {
  supplier?: { id: string; name: string; contact: string | null; notes: string | null };
  triggerLabel: string;
  triggerAriaLabel?: string;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
};

/** Create / edit a supplier in a side drawer. */
export function SupplierDrawer({ supplier, triggerLabel, triggerAriaLabel, triggerVariant = "primary", triggerSize = "md" }: Props) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const { state, formAction, pending, error } = useActionForm(async (prev: ActionState, formData: FormData) => {
    const res = await saveSupplierAction(prev, formData);
    if (res.ok) setOpen(false);
    return res;
  });
  const onSubmit = useNoResetSubmit(formAction);
  const formId = supplier ? `supplier-${supplier.id}` : "supplier-new";


  return (
    <>
      <Button
        variant={triggerVariant}
        size={triggerSize}
        aria-label={triggerAriaLabel}
        aria-haspopup="dialog"
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
      >
        {triggerLabel}
      </Button>
      <ActionToast state={state} errors={false} />
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title={supplier ? copy.suppliers.editTitle : copy.suppliers.newTitle}
        description={supplier?.name}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{copy.form.cancel}</Button>
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              {pending && <Spinner />}
              {supplier ? copy.suppliers.save : copy.suppliers.create}
            </Button>
          </div>
        }
      >
        <form key={formKey} id={formId} onSubmit={onSubmit} className="grid gap-4" noValidate>
          <ActionMessage state={state} showSuccess={false} />
          {supplier && <input type="hidden" name="id" value={supplier.id} />}
          <TextInput label={copy.suppliers.name} name="name" required maxLength={200} defaultValue={supplier?.name ?? ""} error={error("name")} autoComplete="off" />
          <Textarea label={copy.suppliers.contact} name="contact" rows={3} maxLength={1000} hint={copy.suppliers.contactHint} defaultValue={supplier?.contact ?? ""} error={error("contact")} />
          <Textarea label={copy.suppliers.notes} name="notes" rows={4} maxLength={5000} defaultValue={supplier?.notes ?? ""} error={error("notes")} />
        </form>
      </Drawer>
    </>
  );
}
