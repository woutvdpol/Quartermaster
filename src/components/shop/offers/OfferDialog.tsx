"use client";

import { Turnstile } from "@/components/shop/turnstile";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, buttonClasses } from "@/components/shop/ui/Button";
import { inputClasses, textareaClasses } from "@/components/shop/ui/Field";
import { submitOfferAction, type OfferFormState } from "./actions";
import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { offerCopies } from "./_copy";


function Submit() {
  const { pending } = useFormStatus();
  const t = useShopCopy(offerCopies);
  return (
    <button type="submit" disabled={pending} aria-busy={pending || undefined} className={buttonClasses("primary", "md")}>
      {pending ? t.sending : t.submit}
    </button>
  );
}

/** Button + native modal dialog with the offer form (posts to submitOfferAction). */
export function OfferDialog({
  productId,
  priceLabel,
  minimumLabel,
  currency,
  viewer,
}: {
  productId: string;
  priceLabel: string;
  minimumLabel: string;
  currency: string;
  viewer: { name: string | null; email: string } | null;
}) {
  const t = useShopCopy(offerCopies);
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [session, setSession] = useState(0);
  return (
    <>
      <Button variant="outline" fullWidth aria-haspopup="dialog" onClick={() => { setSession((s) => s + 1); ref.current?.showModal(); }}>
        {t.button}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={`${id}-title`}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-shop bg-shop-surface p-0 text-shop-ink shadow-shop-pop backdrop:bg-shop-scrim"
      >
        <OfferForm key={session} id={id} productId={productId} priceLabel={priceLabel} minimumLabel={minimumLabel} currency={currency} viewer={viewer} onClose={() => ref.current?.close()} />
      </dialog>
    </>
  );
}

function OfferForm(props: { id: string; productId: string; priceLabel: string; minimumLabel: string; currency: string; viewer: { name: string | null; email: string } | null; onClose: () => void }) {
  const t = useShopCopy(offerCopies);
  const [state, action] = useActionState<OfferFormState, FormData>(submitOfferAction, null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state && !state.ok) alertRef.current?.focus();
  }, [state]);
  const err = (k: string) => (state && !state.ok ? state.errors?.[k] : undefined);
  const val = (k: string) => (state && !state.ok ? state.values?.[k] : undefined);
  const f = (k: string) => `${props.id}-${k}`;

  if (state?.ok) {
    return (
      <div className="flex flex-col gap-4 p-6 sm:p-8">
        <h2 id={`${props.id}-title`} className="text-2xl">{t.dialogTitle}</h2>
        <p role="status" className="text-shop-ink-2">{t.sent}</p>
        <p className="text-sm text-shop-muted">{t.stillForSale}</p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={props.onClose}>{t.close}</Button>
        </div>
      </div>
    );
  }

  const field = (key: string, label: string, control: React.ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={f(key)} className="text-sm font-medium">{label}</label>
      {control}
      {err(key) ? <p id={`${f(key)}-error`} className="text-xs font-medium text-shop-crit">{err(key)}</p> : null}
    </div>
  );

  return (
    <form action={action} className="flex flex-col gap-4 p-6 sm:p-8" noValidate>
      <h2 id={`${props.id}-title`} className="text-2xl">{t.dialogTitle}</h2>
      <p className="text-sm text-shop-ink-2">{t.intro(props.priceLabel, props.minimumLabel)}</p>
      {state && !state.ok ? (
        <p ref={alertRef} tabIndex={-1} role="alert" className="rounded-shop bg-shop-crit-soft px-4 py-3 text-sm text-shop-crit">{state.message}</p>
      ) : null}
      <input type="hidden" name="productId" value={props.productId} />
      {/* Honeypot: hidden from people, filled in by bots. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>Website <input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {field("amount", `${t.amount} (${props.currency})`, (
        <input id={f("amount")} name="amount" inputMode="decimal" required autoComplete="off" defaultValue={val("amount")} aria-invalid={err("amount") ? true : undefined} aria-describedby={err("amount") ? `${f("amount")}-error` : undefined} className={`${inputClasses} text-lg tabular-nums`} />
      ))}
      {field("name", t.name, (
        <input id={f("name")} name="name" required maxLength={120} autoComplete="name" defaultValue={val("name") ?? props.viewer?.name ?? ""} aria-invalid={err("name") ? true : undefined} className={inputClasses} />
      ))}
      {props.viewer ? (
        <p className="text-sm text-shop-muted">{t.email}: {props.viewer.email}</p>
      ) : (
        field("email", t.email, (
          <input id={f("email")} name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={val("email")} aria-invalid={err("email") ? true : undefined} className={inputClasses} />
        ))
      )}
      {field("message", t.message, (
        <textarea id={f("message")} name="message" rows={3} maxLength={1000} defaultValue={val("message")} className={textareaClasses} />
      ))}
      <Turnstile action="offer" resetKey={state} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={props.onClose}>{t.cancel}</Button>
        <Submit />
      </div>
    </form>
  );
}
