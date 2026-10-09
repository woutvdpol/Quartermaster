"use client";

import { useActionState } from "react";
import { accountCopies } from "@/components/shop/account/_copy";
import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { Alert, Field, Honeypot, SubmitButton } from "@/components/shop/account/form";
import { Turnstile } from "@/components/shop/turnstile";
import { checkClasses } from "@/components/shop/ui/Field";
import { cn } from "@/components/shop/ui/cn";
import { registerAction } from "./actions";

export function RegisterForm({ next, minPasswordLength }: { next: string; minPasswordLength: number }) {
  const copy = useShopCopy(accountCopies);
  const t = copy.register;
  const [state, action] = useActionState(registerAction, undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="relative grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Honeypot />
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field id="name" label={copy.common.name} autoComplete="name" required maxLength={200} defaultValue={state?.values?.name} error={fe.name} />
      <Field
        id="email"
        label={copy.common.email}
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        maxLength={254}
        defaultValue={state?.values?.email}
        error={fe.email}
      />
      <Field
        id="password"
        label={copy.common.password}
        type="password"
        autoComplete="new-password"
        required
        minLength={minPasswordLength}
        hint={t.passwordHint(minPasswordLength)}
        error={fe.password}
      />
      <label className="flex cursor-pointer items-start gap-3 py-1 text-sm text-shop-ink-2">
        <input
          type="checkbox"
          name="newsletter"
          defaultChecked={state?.values?.newsletter}
          className={cn(checkClasses, "mt-0.5")}
        />
        <span>{t.newsletter}</span>
      </label>
      <Turnstile action="register" resetKey={state} />
      <SubmitButton pendingLabel={t.submitting} size="lg" fullWidth>
        {t.submit}
      </SubmitButton>
      <p className="text-xs text-shop-muted">{t.privacy}</p>
    </form>
  );
}
