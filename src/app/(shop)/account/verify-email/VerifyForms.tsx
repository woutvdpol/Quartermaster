"use client";

import Link from "@/components/shop/ui/Link";
import { useActionState } from "react";
import { Alert, SubmitButton } from "@/components/shop/account/form";
import { resendVerificationAction, verifyEmailAction } from "./actions";
import { useLocalizedHref, useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { verifyCopies } from "./_copy";

export function VerifyForm({ token, canResend }: { token: string; canResend: boolean }) {
  const t = useShopCopy(verifyCopies);
  const [state, action] = useActionState(verifyEmailAction, undefined);
  if (state?.ok) {
    return (
      <div className="grid gap-4">
        <Alert tone="success">{state.message}</Alert>
        <Link href="/account" className="text-sm font-medium text-shop-primary underline-offset-4 hover:underline">
          {t.account}
        </Link>
      </div>
    );
  }
  if (state?.invalid) {
    return (
      <div className="grid gap-4">
        <Alert tone="error">{state.message}</Alert>
        <ResendForm canResend={canResend} />
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      {state?.message ? <Alert tone="error">{state.message}</Alert> : null}
      <SubmitButton pendingLabel={t.confirming} fullWidth>
        {t.confirm}
      </SubmitButton>
    </form>
  );
}

export function ResendForm({ canResend }: { canResend: boolean }) {
  const t = useShopCopy(verifyCopies);
  const href = useLocalizedHref();
  const [state, action] = useActionState(resendVerificationAction, undefined);
  if (!canResend) {
    return (
      <p className="text-sm text-shop-muted">
        {t.loginToResend}{" "}
        <Link href={`/login?next=${encodeURIComponent(href("/account/verify-email"))}`} className="font-medium text-shop-primary underline-offset-4 hover:underline">
          {t.login}
        </Link>
      </p>
    );
  }
  return (
    <form action={action} className="grid gap-3">
      {state?.message ? <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert> : null}
      {!state?.ok && (
        <SubmitButton variant="outline" pendingLabel={t.resending} fullWidth>
          {t.resend}
        </SubmitButton>
      )}
    </form>
  );
}
