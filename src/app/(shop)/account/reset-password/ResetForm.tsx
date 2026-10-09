"use client";

import Link from "@/components/shop/ui/Link";
import { useActionState } from "react";
import { accountCopies } from "@/components/shop/account/_copy";
import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { Alert, Field, SubmitButton } from "@/components/shop/account/form";
import { resetPasswordAction } from "./actions";

export function ResetForm({ token, minPasswordLength }: { token: string; minPasswordLength: number }) {
  const copy = useShopCopy(accountCopies);
  const t = copy.reset;
  const [state, action] = useActionState(resetPasswordAction, undefined);
  if (state?.invalidToken) {
    return (
      <div className="grid gap-4">
        <Alert tone="error">{t.invalidToken}</Alert>
        <Link href="/forgot-password" className="text-sm font-medium text-shop-primary underline-offset-4 hover:underline">
          {t.requestNew}
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="token" value={token} />
      {/* Helps password managers attach the new password to the right account. */}
      <input type="text" name="username" autoComplete="username" hidden readOnly />
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field
        id="password"
        label={t.newPassword}
        type="password"
        autoComplete="new-password"
        required
        minLength={minPasswordLength}
        hint={copy.register.passwordHint(minPasswordLength)}
      />
      <Field id="confirm" label={t.confirm} type="password" autoComplete="new-password" required minLength={minPasswordLength} />
      <SubmitButton pendingLabel={t.submitting} fullWidth>
        {t.submit}
      </SubmitButton>
    </form>
  );
}
