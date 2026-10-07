"use client";

import { ActionMessage, ActionToast, FormActions, Select, TextInput, type ActionResult, type ActionState, type SelectOptionGroup } from "@/components/admin/ui";
import { PendingButton, useKeepForm } from "../../_system/client";
import { COMMON_CURRENCIES } from "../_shared";

type Tenant = { name: string; slug: string; currency: string; timezone: string };

export function TenantForm({
  tenant,
  timeZones,
  currencyLocked,
  action,
}: {
  tenant: Tenant;
  timeZones: SelectOptionGroup[];
  currencyLocked: boolean;
  action: (prev: ActionState, formData: FormData) => Promise<ActionResult>;
}) {
  const { state, pending, error, onSubmit } = useKeepForm(action);
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-3">
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <TextInput label="Shop name" name="name" defaultValue={tenant.name} required maxLength={120} error={error("name")} />
      <TextInput label="Slug" name="slug" defaultValue={tenant.slug} required maxLength={48} inputClassName="font-mono" error={error("slug")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label="Currency"
          name="currency"
          defaultValue={tenant.currency}
          list="qm-currencies-edit"
          maxLength={3}
          readOnly={currencyLocked}
          inputClassName="font-mono uppercase"
          hint={currencyLocked ? "Locked: the shop has products or orders." : "ISO code, e.g. EUR."}
          error={error("currency")}
        />
        <Select label="Time zone" name="timezone" defaultValue={tenant.timezone} options={timeZones} error={error("timezone")} />
      </div>
      <datalist id="qm-currencies-edit">
        {COMMON_CURRENCIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <FormActions>
        <PendingButton pending={pending}>Save shop</PendingButton>
      </FormActions>
    </form>
  );
}
