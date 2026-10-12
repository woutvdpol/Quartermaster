"use client";

import { useRef } from "react";
import { ActionMessage, ActionToast, NumberInput, Select, type ActionResult, type ActionState } from "@/components/admin/ui";
import { PendingButton, useKeepForm } from "../../_system/client";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionResult>;

export type PlanFormValues = {
  plan: "START" | "PRO" | "COMPLETE";
  productLimit: number | null;
  photoLimit: number | null;
  storageGb: number | null;
  newsletterQuota: number | null;
};

export type PlanOption = { value: PlanFormValues["plan"]; label: string };

/** Package + limit overrides for one shop. Empty limit fields mean "package default". */
export function PlanForm({ action, values, plans, defaults }: { action: Action; values: PlanFormValues; plans: PlanOption[]; defaults: string }) {
  const { state, pending, error, onSubmit } = useKeepForm(action);
  const num = (v: number | null) => (v === null ? "" : String(v));
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-3">
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <Select label="Package" name="plan" defaultValue={values.plan} options={plans} error={error("plan")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberInput label="Products for sale" name="productLimit" defaultValue={num(values.productLimit)} placeholder="Package default" inputMode="numeric" error={error("productLimit")} />
        <NumberInput label="Photos per product" name="photoLimit" defaultValue={num(values.photoLimit)} placeholder="Package default" inputMode="numeric" error={error("photoLimit")} />
        <NumberInput label="Storage (GB)" name="storageGb" defaultValue={num(values.storageGb)} placeholder="Package default" inputMode="numeric" error={error("storageGb")} />
        <NumberInput label="Newsletter mails / month" name="newsletterQuota" defaultValue={num(values.newsletterQuota)} placeholder="Package default (-1 = unlimited)" inputMode="numeric" error={error("newsletterQuota")} />
      </div>
      <p className="text-xs text-muted">{defaults}</p>
      <div>
        <PendingButton pending={pending} pendingLabel="Saving…">
          Save package
        </PendingButton>
      </div>
    </form>
  );
}

/** Adds purchased newsletter mails (or corrects with a negative number). */
export function CreditsForm({ action }: { action: Action }) {
  const formRef = useRef<HTMLFormElement>(null);
  const { state, pending, error, onSubmit } = useKeepForm(action, { onSuccess: () => formRef.current?.reset() });
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-2.5">
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-40 flex-1">
          <NumberInput label="Add newsletter credits" name="amount" placeholder="5000" inputMode="numeric" error={error("amount")} />
        </div>
        <PendingButton pending={pending} pendingLabel="Adding…" className="mt-[22px]">
          Add
        </PendingButton>
      </div>
    </form>
  );
}
