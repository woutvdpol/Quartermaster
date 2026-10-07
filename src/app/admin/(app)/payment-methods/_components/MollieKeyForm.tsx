"use client";

import { ActionMessage, ActionToast, FormActions, SubmitButton, TextInput, useActionForm } from "@/components/admin/ui";
import { saveMollieKeyAction } from "../actions";

/** Paste a test_/live_ key; it is verified with Mollie before it is stored (encrypted). */
export function MollieKeyForm({ replacing }: { replacing: boolean }) {
  const { state, formAction, error } = useActionForm(saveMollieKeyAction);
  return (
    <form action={formAction} noValidate className="grid gap-3">
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <TextInput
        label={replacing ? "New API key" : "Mollie API key"}
        name="apiKey"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="live_… or test_…"
        inputClassName="font-mono"
        hint="Find it in your Mollie dashboard under Developers → API keys. Use a test key first to try checkout without real payments."
        error={error("apiKey")}
        required
      />
      <FormActions>
        <SubmitButton pendingLabel="Verifying with Mollie…">{replacing ? "Replace key" : "Connect Mollie"}</SubmitButton>
      </FormActions>
    </form>
  );
}
