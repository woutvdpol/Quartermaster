"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/admin/Button";
import { getDictionary } from "@/lib/i18n";
import { verifyTotpAction } from "../actions";
import { FormError, inputClass, labelClass } from "../AuthCard";

const t = getDictionary().twoFactor;

export function TotpForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(verifyTotpAction, undefined);
  const errorId = "totp-error";
  const hintId = "totp-hint";

  if (state?.restart) {
    return (
      <div className="grid gap-4">
        <FormError id={errorId}>{state.error}</FormError>
        <Link href="/admin/login" className="text-[13px] text-accent underline underline-offset-4">
          {t.backToLogin}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state?.error && <FormError id={errorId}>{state.error}</FormError>}
      <div>
        <label htmlFor="code" className={labelClass}>
          {t.code}
        </label>
        <input
          id="code"
          name="code"
          type="text"
          autoComplete="one-time-code"
          inputMode="text"
          spellCheck={false}
          autoCapitalize="none"
          maxLength={32}
          required
          autoFocus
          aria-invalid={state?.error ? true : undefined}
          aria-describedby={state?.error ? `${errorId} ${hintId}` : hintId}
          className={`${inputClass} font-mono tracking-[0.2em]`}
        />
        <p id={hintId} className="mt-1 text-xs text-muted">
          {t.codeHint}
        </p>
      </div>
      <Button type="submit" variant="primary" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? t.submitting : t.submit}
      </Button>
      <p className="text-xs text-muted">{t.useRecovery}</p>
      <Link href="/admin/login" className="text-[13px] text-accent underline underline-offset-4">
        {t.backToLogin}
      </Link>
    </form>
  );
}
