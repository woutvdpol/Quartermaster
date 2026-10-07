"use client";

import { useActionState } from "react";
import { accountCopy } from "@/components/shop/account/_copy";
import { Alert, Field, Honeypot, SubmitButton } from "@/components/shop/account/form";
import { registerAction } from "./actions";

const t = accountCopy.register;

export function RegisterForm({ next, minPasswordLength }: { next: string; minPasswordLength: number }) {
  const [state, action] = useActionState(registerAction, undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="relative grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Honeypot />
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field id="name" label={accountCopy.common.name} autoComplete="name" required maxLength={200} defaultValue={state?.values?.name} error={fe.name} />
      <Field
        id="email"
        label={accountCopy.common.email}
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        maxLength={254}
        defaultValue={state?.values?.email}
        error={fe.email}
      />
      <Field
        id="password"
        label={accountCopy.common.password}
        type="password"
        autoComplete="new-password"
        required
        minLength={minPasswordLength}
        hint={t.passwordHint(minPasswordLength)}
        error={fe.password}
      />
      <label className="flex items-start gap-3 text-sm text-shop-ink-2">
        <input
          type="checkbox"
          name="newsletter"
          defaultChecked={state?.values?.newsletter}
          className="mt-0.5 size-4 shrink-0 accent-[var(--shop-primary)]"
        />
        <span>{t.newsletter}</span>
      </label>
      <SubmitButton pendingLabel={t.submitting} fullWidth>
        {t.submit}
      </SubmitButton>
      <p className="text-xs text-shop-muted">{t.privacy}</p>
    </form>
  );
}
