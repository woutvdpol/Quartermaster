"use client";

import { useActionState } from "react";
import { accountCopy } from "@/components/shop/account/_copy";
import { Alert, Field, SubmitButton } from "@/components/shop/account/form";
import { Button } from "@/components/shop/ui/Button";
import { cancelTotpAction, shopVerifyTotpAction } from "../actions";

const t = accountCopy.twoFactor;

export function TotpForm({ next }: { next: string }) {
  const [state, action] = useActionState(shopVerifyTotpAction, undefined);
  return (
    <div className="grid gap-4">
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.restart ? (
        <form action={cancelTotpAction}>
          <Button type="submit" variant="outline" fullWidth>
            {t.restart}
          </Button>
        </form>
      ) : (
        <form action={action} className="grid gap-4" noValidate>
          <input type="hidden" name="next" value={next} />
          <Field id="code" className="[&_input]:font-shop-mono [&_input]:tracking-[0.2em]" label={t.code} autoComplete="one-time-code" inputMode="text" autoFocus required maxLength={32} />
          <SubmitButton pendingLabel={t.submitting} size="lg" fullWidth>
            {t.submit}
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
