"use client";

import Link from "next/link";
import { useActionState } from "react";
import { accountCopy } from "@/components/shop/account/_copy";
import { Alert, Field, SubmitButton } from "@/components/shop/account/form";
import { shopLoginAction } from "./actions";

const t = accountCopy.login;

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(shopLoginAction, undefined);
  const err = state?.error ? "login-error" : undefined;
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state?.error ? (
        <Alert tone="error" id="login-error">
          {state.error}
        </Alert>
      ) : null}
      <Field
        id="email"
        label={accountCopy.common.email}
        type="email"
        autoComplete="username"
        inputMode="email"
        required
        defaultValue={state?.email}
        aria-describedby={err}
      />
      <Field id="password" label={accountCopy.common.password} type="password" autoComplete="current-password" required aria-describedby={err} />
      <div className="-mt-2 -mb-1 text-right text-sm">
        <Link href="/forgot-password" className="inline-flex min-h-11 items-center font-medium text-shop-ink-2 underline underline-offset-4 hover:text-shop-primary">
          {t.forgot}
        </Link>
      </div>
      <SubmitButton pendingLabel={t.submitting} size="lg" fullWidth>
        {t.submit}
      </SubmitButton>
    </form>
  );
}
