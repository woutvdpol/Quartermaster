"use client";

import { useActionState } from "react";
import { accountCopy } from "./_copy";
import { Alert, Field, SubmitButton } from "./form";

type State = { ok?: boolean; message?: string; error?: string; fieldErrors?: Record<string, string> } | undefined;
type Action = (prev: State, formData: FormData) => Promise<State>;

function Feedback({ state }: { state: State }) {
  if (state?.error) return <Alert tone="error">{state.error}</Alert>;
  if (state?.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

export function ProfileForm({ action, name, phone }: { action: Action; name: string; phone: string }) {
  const [state, formAction] = useActionState(action, undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <Feedback state={state} />
      <Field id="name" label={accountCopy.common.name} autoComplete="name" required maxLength={200} defaultValue={name} error={fe.name} />
      <Field id="phone" label={accountCopy.common.phone} type="tel" autoComplete="tel" maxLength={40} defaultValue={phone} error={fe.phone} />
      <div>
        <SubmitButton pendingLabel={accountCopy.common.saving}>{accountCopy.common.save}</SubmitButton>
      </div>
    </form>
  );
}

export function EmailForm({ action, email }: { action: Action; email: string }) {
  const t = accountCopy.profile;
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <Feedback state={state} />
      <p className="text-sm text-shop-muted">
        {t.emailIntro} <span className="font-medium text-shop-ink-2">{email}</span>
      </p>
      <Field id="new-email" name="email" label={t.newEmail} type="email" autoComplete="email" inputMode="email" required maxLength={254} />
      <Field id="email-password" name="password" label={t.currentPassword} type="password" autoComplete="current-password" required />
      <div>
        <SubmitButton pendingLabel={accountCopy.common.saving}>{t.changeEmail}</SubmitButton>
      </div>
    </form>
  );
}

export function PasswordForm({ action, email, minPasswordLength }: { action: Action; email: string; minPasswordLength: number }) {
  const t = accountCopy.profile;
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid gap-4" noValidate key={state?.ok ? "done" : "form"}>
      <Feedback state={state} />
      <input type="text" name="username" autoComplete="username" defaultValue={email} hidden readOnly />
      <Field id="current" label={t.currentPassword} type="password" autoComplete="current-password" required />
      <Field
        id="newPassword"
        label={t.newPassword}
        type="password"
        autoComplete="new-password"
        required
        minLength={minPasswordLength}
        hint={accountCopy.register.passwordHint(minPasswordLength)}
      />
      <Field id="confirm" label={t.confirmPassword} type="password" autoComplete="new-password" required minLength={minPasswordLength} />
      <div>
        <SubmitButton pendingLabel={accountCopy.common.saving}>{t.changePassword}</SubmitButton>
      </div>
    </form>
  );
}
