"use client";

import { useState } from "react";
import { ActionMessage, ActionToast, FormActions, TextInput } from "@/components/admin/ui";
import { PendingButton, useKeepForm } from "../../_system/client";
import { updateProfileAction } from "../actions";

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [emailValue, setEmailValue] = useState(email);
  const { state, pending, error, onSubmit } = useKeepForm(updateProfileAction);
  const emailChanged = emailValue.trim().toLowerCase() !== email.toLowerCase();
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-3">
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <TextInput label="Name" name="name" defaultValue={name} maxLength={120} autoComplete="name" showOptional error={error("name")} />
      <TextInput
        label="E-mail"
        name="email"
        type="email"
        value={emailValue}
        onChange={(e) => setEmailValue(e.target.value)}
        autoComplete="email"
        required
        maxLength={254}
        hint="You sign in with this address."
        error={error("email")}
      />
      {emailChanged && (
        <TextInput
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          hint="Needed to change your e-mail address."
          error={error("currentPassword")}
        />
      )}
      <FormActions>
        <PendingButton pending={pending}>Save profile</PendingButton>
      </FormActions>
    </form>
  );
}
