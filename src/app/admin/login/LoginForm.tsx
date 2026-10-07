"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/admin/Button";
import { getDictionary } from "@/lib/i18n";
import { loginAction } from "./actions";
import { FormError, inputClass, labelClass } from "./AuthCard";

const t = getDictionary().login;

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  const errorId = "login-error";
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state?.error && <FormError id={errorId}>{state.error}</FormError>}
      <div>
        <label htmlFor="email" className={labelClass}>
          {t.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
          defaultValue={state?.email}
          aria-invalid={state?.error ? true : undefined}
          aria-describedby={state?.error ? errorId : undefined}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="password" className={labelClass}>
          {t.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state?.error ? true : undefined}
          aria-describedby={state?.error ? errorId : undefined}
          className={inputClass}
        />
      </div>
      <Button type="submit" variant="primary" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? t.submitting : t.submit}
      </Button>
      <Link
        href="/admin/forgot-password"
        className="justify-self-center text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline"
      >
        Forgot password?
      </Link>
    </form>
  );
}
