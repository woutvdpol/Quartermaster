"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, buttonClasses } from "@/components/admin/Button";
import { FormError, inputClass, labelClass } from "../login/AuthCard";
import { copy } from "./_copy";
import { resetPasswordAction } from "./actions";

export function InvalidLink() {
  return (
    <div className="grid gap-4">
      <div
        role="alert"
        className="rounded-control border border-warn bg-warn-soft px-3 py-2.5 text-[13.5px] text-ink"
      >
        <p className="font-semibold">{copy.invalidTitle}</p>
        <p className="mt-1">{copy.invalidBody}</p>
      </div>
      <Link
        href="/admin/forgot-password"
        className={buttonClasses({ variant: "primary", size: "lg" })}
      >
        {copy.requestNew}
      </Link>
      <Link
        href="/admin/login"
        className="text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline"
      >
        ← {copy.backToLogin}
      </Link>
    </div>
  );
}

export function ResetPasswordForm({
  token,
  minLength,
}: {
  token: string;
  minLength: number;
}) {
  const [state, action, pending] = useActionState(
    resetPasswordAction,
    undefined,
  );

  if (state?.status === "done") {
    return (
      <div className="grid gap-4">
        <div
          role="status"
          className="rounded-control border border-ok bg-ok-soft px-3 py-2.5 text-[13.5px] text-ink"
        >
          <p className="font-semibold">{copy.doneTitle}</p>
          <p className="mt-1">{copy.doneBody}</p>
        </div>
        <Link
          href="/admin/login"
          className={buttonClasses({ variant: "primary", size: "lg" })}
        >
          {copy.toLogin}
        </Link>
      </div>
    );
  }
  if (state?.status === "invalid_token") return <InvalidLink />;

  const error = state?.status === "error" ? state : null;
  const errorId = "reset-error";
  const hintId = "password-hint";
  const invalid = (field: "password" | "confirm") =>
    error && (!error.field || error.field === field) ? true : undefined;

  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="token" value={token} />
      {error && <FormError id={errorId}>{error.error}</FormError>}
      <div>
        <label htmlFor="password" className={labelClass}>
          {copy.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={minLength}
          autoFocus
          aria-invalid={invalid("password")}
          aria-describedby={[hintId, invalid("password") && errorId]
            .filter(Boolean)
            .join(" ")}
          className={inputClass}
        />
        <p id={hintId} className="mt-1 text-xs text-muted">
          {copy.hint(minLength)}
        </p>
      </div>
      <div>
        <label htmlFor="confirm" className={labelClass}>
          {copy.confirm}
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={minLength}
          aria-invalid={invalid("confirm")}
          aria-describedby={invalid("confirm") ? errorId : undefined}
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
    </form>
  );
}
