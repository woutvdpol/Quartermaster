"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/admin/Button";
import { FormError, inputClass, labelClass } from "../login/AuthCard";
import { copy } from "./_copy";
import { forgotPasswordAction } from "./actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(
    forgotPasswordAction,
    undefined,
  );
  const errorId = "forgot-error";

  if (state?.sent) {
    return (
      <div className="grid gap-4">
        <div
          role="status"
          className="rounded-control border border-ok bg-ok-soft px-3 py-2.5 text-[13.5px] text-ink"
        >
          <p className="font-semibold">{copy.sentTitle}</p>
          <p className="mt-1">{copy.sent}</p>
        </div>
        <Link
          href="/admin/login"
          className="text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          ← {copy.backToLogin}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4" noValidate>
      {state?.error && <FormError id={errorId}>{state.error}</FormError>}
      <div>
        <label htmlFor="email" className={labelClass}>
          {copy.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
          aria-invalid={state?.error ? true : undefined}
          aria-describedby={state?.error ? errorId : undefined}
          className={inputClass}
        />
      </div>
      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? copy.submitting : copy.submit}
      </Button>
      <Link
        href="/admin/login"
        className="text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline"
      >
        ← {copy.backToLogin}
      </Link>
    </form>
  );
}
