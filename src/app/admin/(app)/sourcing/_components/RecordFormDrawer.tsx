"use client";

import { useState } from "react";
import {
  ActionMessage,
  ActionToast,
  Button,
  DateInput,
  Drawer,
  MoneyInput,
  Select,
  Spinner,
  TextInput,
  Textarea,
  useActionForm,
  type ActionState,
  type ButtonVariant,
} from "@/components/admin/ui";
import { createRecordAction, updateRecordAction } from "../actions";
import { copy } from "../_copy";
import { useNoResetSubmit } from "./use-no-reset-submit";

export type RecordFormValues = {
  id: string;
  purchasedAt: string; // YYYY-MM-DD
  supplierId: string | null;
  invoiceNumber: string | null;
  totalCost: number | null;
  notes: string | null;
};

type Props = {
  record?: RecordFormValues;
  suppliers: { id: string; name: string }[];
  currency: string;
  /** Default purchase date for new records (tenant-local today). */
  today: string;
  triggerLabel: string;
  triggerVariant?: ButtonVariant;
};

/** Create / edit a purchase record in a side drawer. Creating navigates to the new record. */
export function RecordFormDrawer({ record, suppliers, currency, today, triggerLabel, triggerVariant = "primary" }: Props) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const { state, formAction, pending, error } = useActionForm(async (prev: ActionState, formData: FormData) => {
    const res = await (record ? updateRecordAction : createRecordAction)(prev, formData);
    if (res.ok) setOpen(false);
    return res;
  });
  const onSubmit = useNoResetSubmit(formAction);

  function openDrawer() {
    setFormKey((k) => k + 1); // fresh values each time it opens
    setOpen(true);
  }

  const formId = record ? `record-form-${record.id}` : "record-form-new";

  return (
    <>
      <Button variant={triggerVariant} onClick={openDrawer} aria-haspopup="dialog">
        {triggerLabel}
      </Button>
      <ActionToast state={state} errors={false} />
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title={record ? copy.form.editTitle : copy.form.newTitle}
        description={record ? undefined : copy.form.newDescription}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{copy.form.cancel}</Button>
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              {pending && <Spinner />}
              {record ? copy.form.save : copy.form.create}
            </Button>
          </div>
        }
      >
        <form key={formKey} id={formId} onSubmit={onSubmit} className="grid gap-4" noValidate>
          <ActionMessage state={state} showSuccess={false} />
          {record && <input type="hidden" name="id" value={record.id} />}
          <DateInput
            label={copy.form.purchasedAt}
            name="purchasedAt"
            required
            defaultValue={record?.purchasedAt ?? today}
            error={error("purchasedAt")}
          />
          <Select
            label={copy.form.supplier}
            name="supplierId"
            defaultValue={record?.supplierId ?? ""}
            hint={suppliers.length === 0 ? copy.form.supplierHint : undefined}
            error={error("supplierId")}
            options={[{ value: "", label: copy.form.noSupplier }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
          />
          <TextInput
            label={copy.form.invoiceNumber}
            name="invoiceNumber"
            defaultValue={record?.invoiceNumber ?? ""}
            maxLength={100}
            autoComplete="off"
            error={error("invoiceNumber")}
          />
          <MoneyInput
            label={copy.form.totalCost}
            name="totalCost"
            currency={currency}
            defaultValue={record?.totalCost ?? null}
            hint={copy.form.totalCostHint}
            error={error("totalCost")}
          />
          <Textarea label={copy.form.notes} name="notes" defaultValue={record?.notes ?? ""} rows={4} maxLength={5000} error={error("notes")} />
        </form>
      </Drawer>
    </>
  );
}
