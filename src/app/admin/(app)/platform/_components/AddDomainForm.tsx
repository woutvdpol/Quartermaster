"use client";

import { useRef } from "react";
import { ActionMessage, ActionToast, Checkbox, TextInput, type ActionResult, type ActionState } from "@/components/admin/ui";
import { PendingButton, useKeepForm } from "../../_system/client";

export function AddDomainForm({ action }: { action: (prev: ActionState, formData: FormData) => Promise<ActionResult> }) {
  const formRef = useRef<HTMLFormElement>(null);
  const { state, pending, error, onSubmit } = useKeepForm(action, { onSuccess: () => formRef.current?.reset() });
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-2.5">
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-56 flex-1">
          <TextInput label="Add domain" name="host" placeholder="www.example.com" inputClassName="font-mono" error={error("host")} />
        </div>
        <PendingButton pending={pending} pendingLabel="Adding…" className="mt-[22px]">
          Add
        </PendingButton>
      </div>
      <Checkbox name="primary" label="Make this the primary domain" description="Invite and mail links use the primary domain." />
    </form>
  );
}
