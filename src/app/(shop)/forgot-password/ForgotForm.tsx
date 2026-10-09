"use client";

import { useActionState } from "react";
import { accountCopies } from "@/components/shop/account/_copy";
import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { Alert, Field, Honeypot, SubmitButton } from "@/components/shop/account/form";
import { Turnstile } from "@/components/shop/turnstile";
import { forgotPasswordAction } from "./actions";

export function ForgotForm() {
  const copy = useShopCopy(accountCopies);
  const t = copy.forgot;
  const [state, action] = useActionState(forgotPasswordAction, undefined);
  if (state?.sent) return <Alert tone="success">{t.sent}</Alert>;
  return (
    <form action={action} className="relative grid gap-4" noValidate>
      <Honeypot />
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field id="email" label={copy.common.email} type="email" autoComplete="email" inputMode="email" required defaultValue={state?.email} />
      <Turnstile action="forgot_password" resetKey={state} />
      <SubmitButton pendingLabel={t.submitting} size="lg" fullWidth>
        {t.submit}
      </SubmitButton>
    </form>
  );
}
