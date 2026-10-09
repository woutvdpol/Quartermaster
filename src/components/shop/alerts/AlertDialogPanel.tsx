"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/shop/ui/Button";
import { Field, TextInput } from "@/components/shop/ui/Field";
import { Turnstile } from "@/components/shop/turnstile";
import { alertsCopy } from "./_copy";
import { createAlertAction, getAlertDialogStateAction, type AlertDialogState, type CreateAlertResult } from "./actions";
import { PushChoice } from "@/components/shop/push/PushChoice";
import { pushUiCopy } from "@/components/shop/push/_copy";

const t = alertsCopy;
type Frequency = "INSTANT" | "DAILY" | "WEEKLY";

/**
 * The dialog of AlertDialogButton (NotifyMeButton / SaveSearchButton), loaded on the first click
 * (performance: form, Turnstile and copy stay out of the catalog/product page bundle). The visitor's
 * email (customers) is loaded via a server action when it opens.
 */
export function AlertDialogPanel({
  source,
  title,
  intro,
  defaultFrequency = "INSTANT",
}: {
  /** `{ productId }` (suggest from product) or `{ query: CatalogSearchInput }`. */
  source: unknown;
  title: string;
  intro: string;
  defaultFrequency?: Frequency;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [state, setState] = useState<AlertDialogState | null>(null);
  const [result, setResult] = useState<CreateAlertResult | null>(null);
  const [saved, setSaved] = useState<{ name: string; frequency: Frequency } | null>(null);
  const [pending, startTransition] = useTransition();

  // Mounted (with a fresh key) by every click of the trigger: open and load the visitor's state.
  useEffect(() => {
    dialogRef.current?.showModal();
    getAlertDialogStateAction(source)
      .then(setState)
      .catch(() => setState({ loggedIn: false, email: null, defaultName: "", summary: "", pushPublicKey: null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount (per click)
  }, []);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === d) d.close(); // backdrop
    };
    d.addEventListener("click", onClick);
    return () => d.removeEventListener("click", onClick);
  }, []);

  function submit(formData: FormData) {
    const name = String(formData.get("name") ?? "");
    const frequency = String(formData.get("frequency") ?? defaultFrequency) as Frequency;
    startTransition(async () => {
      const res = await createAlertAction({
        source,
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        frequency: String(formData.get("frequency") ?? defaultFrequency) as Frequency,
        website: String(formData.get("website") ?? ""),
        turnstileToken: (formData.get("cf-turnstile-response") as string | null) ?? null,
      });
      setResult(res);
      setSaved({ name: name.trim() || state?.defaultName || "", frequency });
    });
  }

  const done = result && (result.status === "created" || result.status === "pending" || result.status === "duplicate");
  const message = result ? (result.message ?? t.result[result.status]) : null;
  const pushChoice = done && result?.id && state?.pushPublicKey && saved ? { id: result.id, key: state.pushPublicKey, ...saved } : null;

  return (
    <>
      <dialog
        ref={dialogRef}
        aria-labelledby={`${id}-title`}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-shop bg-shop-surface p-0 text-shop-ink shadow-shop-pop backdrop:bg-shop-scrim"
      >
        <div className="p-6 sm:p-8">
          <div className="mb-3 flex items-start justify-between gap-4">
            <h2 id={`${id}-title`} className="text-2xl">
              {pushChoice ? pushUiCopy.choice.title : title}
            </h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="-m-2 grid size-10 shrink-0 place-items-center rounded-shop-control text-shop-muted hover:bg-shop-sunken hover:text-shop-ink"
              aria-label={t.form.close}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {pushChoice ? (
            // Logged-in customer + push available: "Push alert on this phone" vs "E-mail" (docs/push.md).
            <PushChoice
              searchId={pushChoice.id}
              searchName={pushChoice.name}
              frequency={pushChoice.frequency}
              publicKey={pushChoice.key}
              onClose={() => dialogRef.current?.close()}
            />
          ) : done ? (
            <div className="grid gap-4">
              <p role="status" className="rounded-shop bg-shop-ok-soft px-4 py-3 text-sm text-shop-ok">
                {message}
              </p>
              <div className="flex justify-end gap-2">
                {state?.loggedIn ? (
                  <Link href="/account/alerts" className="self-center text-sm text-shop-primary underline underline-offset-4">
                    {t.manageLink}
                  </Link>
                ) : null}
                <Button variant="primary" onClick={() => dialogRef.current?.close()}>
                  {t.form.close}
                </Button>
              </div>
            </div>
          ) : (
            <form action={submit} className="grid gap-4">
              <p className="text-sm text-shop-ink-2">{intro}</p>
              {state?.summary ? (
                <p className="rounded-shop bg-shop-sunken px-4 py-3 text-sm">
                  <span className="text-shop-muted">{t.form.criteria}: </span>
                  {state.summary}
                </p>
              ) : null}
              <Field id={`${id}-name`} label={t.form.name} hint={t.form.nameHint}>
                <TextInput
                  id={`${id}-name`}
                  name="name"
                  maxLength={120}
                  key={state?.defaultName ?? "loading"}
                  defaultValue={state?.defaultName ?? ""}
                  aria-describedby={`${id}-name-hint`}
                />
              </Field>
              {state?.loggedIn ? (
                <p className="text-sm text-shop-ink-2">
                  {t.form.email}: <strong>{state.email}</strong>
                </p>
              ) : (
                <Field id={`${id}-email`} label={t.form.email} required>
                  <TextInput id={`${id}-email`} name="email" type="email" autoComplete="email" required maxLength={254} />
                </Field>
              )}
              <fieldset className="grid gap-1.5">
                <legend className="mb-1 text-sm font-medium">{t.form.frequency}</legend>
                {(["INSTANT", "DAILY", "WEEKLY"] as const).map((f) => (
                  <label key={f} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="frequency" value={f} defaultChecked={f === defaultFrequency} className="accent-shop-primary" />
                    {t.form.frequencies[f]}
                  </label>
                ))}
              </fieldset>
              <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label htmlFor={`${id}-website`}>Website</label>
                <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
              </div>
              {message ? (
                <p role="alert" className="rounded-shop bg-shop-crit-soft px-4 py-3 text-sm text-shop-crit">
                  {message}
                </p>
              ) : null}
              {state ? <Turnstile action="alert" resetKey={result} /> : null}
              <p className="text-xs text-shop-muted">{t.form.privacy}</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
                  {t.form.cancel}
                </Button>
                <Button type="submit" variant="primary" pending={pending || !state}>
                  {pending ? t.form.submitting : t.form.submit}
                </Button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
