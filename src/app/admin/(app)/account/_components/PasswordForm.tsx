"use client";

import { useRef } from "react";
import { ActionMessage, ActionToast, FormActions, TextInput } from "@/components/admin/ui";
import { PendingButton, useKeepForm } from "../../_system/client";
import { changePasswordAction } from "../actions";

export function PasswordForm({ minLength }: { minLength: number }) {
  const formRef = useRef<HTMLFormElement>(null);
  const { state, pending, error, onSubmit } = useKeepForm(changePasswordAction, { onSuccess: () => formRef.current?.reset() });
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-3">
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <TextInput label="Current password" name="currentPassword" type="password" autoComplete="current-password" required error={error("currentPassword")} />
      <TextInput
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={minLength}
        hint={`At least ${minLength} characters. A long passphrase is best.`}
        error={error("newPassword")}
      />
      <TextInput label="Repeat new password" name="confirmPassword" type="password" autoComplete="new-password" required error={error("confirmPassword")} />
      <FormActions start="Other devices are signed out after the change.">
        <PendingButton pending={pending}>Change password</PendingButton>
      </FormActions>
    </form>
  );
}
