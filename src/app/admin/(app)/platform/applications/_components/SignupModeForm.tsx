"use client";

import { useState } from "react";
import { ActionMessage, ActionToast, NumberInput, RadioGroup } from "@/components/admin/ui";
import type { SignupConfig } from "@/server/platform/signup";
import { PendingButton, useKeepForm } from "../../../_system/client";
import { saveSignupConfigAction } from "../actions";

const MODES = [
  { value: "APPLY", label: "Apply — reviewed by hand", description: "Dealers apply and confirm their email; you approve or reject before they get an invite." },
  { value: "WAITLIST", label: "Waitlist", description: "Dealers join the waitlist without a notification each; you invite them in sign-up order when there is room." },
  { value: "TRIAL", label: "Free trial — straight into the wizard", description: "The shop is created once the email is confirmed; the dealer sets a password and starts the setup wizard." },
];

/** Platform-wide sign-up mode (docs/design/signup-modes.html §1). */
export function SignupModeForm({ config }: { config: SignupConfig }) {
  const { state, pending, error, onSubmit } = useKeepForm(saveSignupConfigAction);
  const [mode, setMode] = useState<string>(config.signupMode);
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-3">
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <RadioGroup name="signupMode" legend="How dealers sign up" legendHidden value={mode} onValueChange={setMode} options={MODES} error={error("signupMode")} />
      {mode === "TRIAL" ? (
        <NumberInput label="Trial length (days)" name="trialDays" defaultValue={String(config.trialDays)} inputMode="numeric" className="max-w-48" error={error("trialDays")} />
      ) : (
        <input type="hidden" name="trialDays" value={config.trialDays} />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <PendingButton pending={pending}>Save</PendingButton>
        <p className="text-xs text-muted">Applies to new sign-ups. Applications already sent keep their mode.</p>
      </div>
    </form>
  );
}
