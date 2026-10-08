"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, buttonClasses } from "@/components/admin/Button";
import { FormError, inputClass, labelClass } from "../login/AuthCard";
import { copy } from "./_copy";
import { acceptInviteAction } from "./actions";

export function InvalidInvite() {
  return (
    <div className="grid gap-4">
      <div role="alert" className="rounded-control border border-warn bg-warn-soft px-3 py-2.5 text-[13.5px] text-ink">
        <p className="font-semibold">{copy.invalidTitle}</p>
        <p className="mt-1">{copy.invalidBody}</p>
      </div>
      <Link href="/admin/login" className={buttonClasses({ variant: "primary", size: "lg" })}>
        {copy.toLogin}
      </Link>
    </div>
  );
}

export function AcceptInviteForm({ token, minLength, email }: { token: string; minLength: number; email: string | null }) {
  const [state, action, pending] = useActionState(acceptInviteAction, undefined);
  if (state?.status === "invalid_token") return <InvalidInvite />;

  const error = state?.status === "error" ? state : null;
  const errorId = "invite-error";
  const hintId = "password-hint";
  const invalid = (field: "password" | "confirm") => (error && (!error.field || error.field === field) ? true : undefined);

  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="token" value={token} />
      {error && <FormError id={errorId}>{error.error}</FormError>}
      {email ? (
        <div>
          <label htmlFor="username" className={labelClass}>
            {copy.email}
          </label>
          {/* Lets password managers store the new password under the right account. */}
          <input id="username" name="username" type="email" autoComplete="username" value={email} readOnly className={`${inputClass} bg-panel-2`} />
        </div>
      ) : null}
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
          aria-describedby={[hintId, invalid("password") && errorId].filter(Boolean).join(" ")}
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
      <Button type="submit" variant="primary" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? copy.submitting : copy.submit}
      </Button>
    </form>
  );
}
