"use client";

import { useState } from "react";
import {
  ActionMessage,
  ActionToast,
  FormActions,
  SubmitButton,
  TextInput,
  useActionForm,
} from "@/components/admin/ui";
import { copy } from "../_copy";
import { sendTestAction } from "../actions";

const t = copy.test;

/** "Send a test" card body: one address, queued as a "[Test]" mail (no quota). */
export function TestSendForm({
  campaignId,
  defaultEmail,
  blockedReason,
}: {
  campaignId: string;
  defaultEmail: string;
  blockedReason?: string;
}) {
  const { state, formAction, error } = useActionForm(sendTestAction);
  // Controlled, so the address survives the form reset React does after an action.
  const [email, setEmail] = useState(defaultEmail);
  return (
    <form action={formAction} className="grid gap-3" noValidate>
      <input type="hidden" name="id" value={campaignId} />
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <TextInput
        label={t.email}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        hint={blockedReason ?? t.hint}
        error={error("email")}
      />
      <FormActions>
        <SubmitButton
          pendingLabel={t.sending}
          disabled={Boolean(blockedReason)}
        >
          {t.send}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
