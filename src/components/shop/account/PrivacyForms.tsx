"use client";

import { useActionState, useRef } from "react";
import { Button } from "@/components/shop/ui/Button";
import { accountCopy } from "./_copy";
import { Alert, Field, SubmitButton } from "./form";

type State = { ok?: boolean; message?: string; error?: string } | undefined;
type Action = (prev: State, formData: FormData) => Promise<State>;

const t = accountCopy.privacy;

export function NewsletterForm({ action, status }: { action: Action; status: "active" | "pending" | "unsubscribed" | "none" }) {
  const [state, formAction] = useActionState(action, undefined);
  const subscribed = status === "active";
  return (
    <form action={formAction} className="grid gap-4">
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : (
        <p className="text-sm text-shop-ink-2">{t.status[status]}</p>
      )}
      <input type="hidden" name="subscribe" value={subscribed ? "0" : "1"} />
      <div>
        <SubmitButton variant={subscribed ? "outline" : "primary"} pendingLabel={accountCopy.common.saving}>
          {subscribed ? t.unsubscribe : status === "pending" ? t.resend : t.subscribe}
        </SubmitButton>
      </div>
    </form>
  );
}

/** "Delete my account" with a confirmation dialog that asks for the password. */
export function DeleteAccount({ action, email }: { action: Action; email: string }) {
  const [state, formAction] = useActionState(action, undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <div className="grid gap-4">
      <p className="text-sm text-shop-ink-2">{t.deleteIntro}</p>
      <div>
        <Button variant="outline" className="border-shop-crit/40 text-shop-crit hover:border-shop-crit" onClick={() => dialog.current?.showModal()}>
          {t.deleteButton}
        </Button>
      </div>
      <dialog
        ref={dialog}
        aria-labelledby="delete-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-shop border border-shop-line bg-shop-surface p-6 text-shop-ink shadow-shop-pop backdrop:bg-shop-ink/50 sm:p-8"
      >
        <form action={formAction} className="grid gap-4">
          <h2 id="delete-title" className="text-xl">
            {t.deleteDialogTitle}
          </h2>
          <p className="text-sm text-shop-ink-2">{t.deleteDialogBody}</p>
          {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
          <input type="text" name="username" autoComplete="username" defaultValue={email} hidden readOnly />
          <Field id="delete-password" name="password" label={accountCopy.common.password} type="password" autoComplete="current-password" required />
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="ghost" onClick={() => dialog.current?.close()}>
              {accountCopy.common.cancel}
            </Button>
            <SubmitButton variant="accent" pendingLabel={accountCopy.common.saving}>
              {t.deleteConfirm}
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </div>
  );
}
