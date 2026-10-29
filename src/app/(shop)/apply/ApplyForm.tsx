"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/components/shop/ui/cn";
import { Turnstile } from "@/components/shop/turnstile/Turnstile";
import { buttonClass } from "../_platform/parts";
import { AlertIcon } from "../_platform/icons";
import { submitApplicationAction, type ApplyFormState } from "./actions";
import { applyCopy } from "./_copy";

const t = applyCopy;

// 16px text at every width: smaller input text makes iOS zoom in when a field is tapped.
const inputClass =
  "block h-[46px] w-full rounded-lg border border-pf-line bg-pf-paper px-3.5 text-base text-pf-ink transition-colors duration-200 ease-pf-out hover:border-pf-muted " +
  "focus-visible:rounded-lg focus-visible:border-pf-brass focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pf-brass aria-invalid:border-pf-crit";

/** Field order, so the error summary lists the problems as they appear in the form. */
const FIELD_ORDER = ["applicantName", "email", "shopName", "country", "cocNumber", "currentPlatform", "description", "legalConsent"] as const;

type Option = { value: string; label: string };

function ErrorLine({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="flex gap-1.5 text-sm leading-[1.45] font-medium text-pf-crit">
      <AlertIcon className="mt-0.5 size-4 flex-none" />
      <span>{children}</span>
    </p>
  );
}

function FieldShell({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-2">
      <label htmlFor={id} className="text-[15px] leading-[1.3] font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm leading-[1.45] text-pf-muted">
          {hint}
        </p>
      ) : null}
      {error ? <ErrorLine id={`${id}-error`}>{error}</ErrorLine> : null}
    </div>
  );
}

function describedBy(id: string, hint?: string, error?: string) {
  return [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={cn(buttonClass.primary, "w-full disabled:cursor-progress")} disabled={pending} aria-disabled={pending}>
      {pending ? (
        <>
          <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/35 border-t-white motion-reduce:animate-none" />
          {t.submitting}
        </>
      ) : (
        label
      )}
    </button>
  );
}

export function ApplyForm({
  countries,
  platforms,
  submitLabel,
  footnote,
}: {
  countries: Option[];
  platforms: Option[];
  submitLabel: string;
  footnote: string;
}) {
  const [state, formAction] = useActionState<ApplyFormState, FormData>(submitApplicationAction, null);
  const v = state?.values ?? {};
  const fe: Partial<Record<(typeof FIELD_ORDER)[number], string>> = state?.fieldErrors ?? {};
  const text = (name: keyof typeof v) => (typeof v[name] === "string" ? (v[name] as string) : "");
  const summary = useRef<HTMLDivElement>(null);
  const problems = FIELD_ORDER.filter((name) => fe[name]);

  // After a failed attempt, move focus to the summary so screen readers and keyboards start there.
  useEffect(() => {
    if (state?.error) summary.current?.focus();
  }, [state?.attempt, state?.error]);

  return (
    // Re-mount after each failed attempt so the typed values come back as defaults (React resets form fields).
    <form key={state?.attempt ?? 0} action={formAction} noValidate className="mt-[22px] grid gap-5">
      {state?.error ? (
        <div ref={summary} role="alert" tabIndex={-1} className="grid gap-1.5 rounded-lg bg-pf-crit-soft px-3.5 py-3 text-[15px] leading-[1.45] font-medium text-pf-crit">
          <p className="flex gap-2">
            <AlertIcon className="mt-0.5 size-[18px] flex-none" />
            <span>{state.error}</span>
          </p>
          {problems.length ? (
            <ul className="grid gap-0.5 pl-[26px]">
              {problems.map((name) => (
                <li key={name}>
                  <a href={`#${name === "currentPlatform" ? "currentPlatform-group" : name}`} className="text-pf-crit underline underline-offset-2">
                    {fe[name]}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-5 sm:grid-cols-2 sm:gap-x-4">
        <FieldShell id="applicantName" label={t.fields.applicantName} error={fe.applicantName}>
          <input
            id="applicantName"
            name="applicantName"
            autoComplete="name"
            required
            maxLength={120}
            defaultValue={text("applicantName")}
            aria-invalid={fe.applicantName ? true : undefined}
            aria-describedby={describedBy("applicantName", undefined, fe.applicantName)}
            className={inputClass}
          />
        </FieldShell>
        <FieldShell id="email" label={t.fields.email} error={fe.email}>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            defaultValue={text("email")}
            aria-invalid={fe.email ? true : undefined}
            aria-describedby={describedBy("email", undefined, fe.email)}
            className={inputClass}
          />
        </FieldShell>
      </div>

      <FieldShell id="shopName" label={t.fields.shopName} error={fe.shopName}>
        <input
          id="shopName"
          name="shopName"
          autoComplete="organization"
          required
          maxLength={80}
          defaultValue={text("shopName")}
          aria-invalid={fe.shopName ? true : undefined}
          aria-describedby={describedBy("shopName", undefined, fe.shopName)}
          className={inputClass}
        />
      </FieldShell>

      <div className="grid gap-5 sm:grid-cols-2 sm:gap-x-4">
        <FieldShell id="country" label={t.fields.country} error={fe.country}>
          <select
            id="country"
            name="country"
            required
            defaultValue={text("country") || "NL"}
            aria-invalid={fe.country ? true : undefined}
            aria-describedby={describedBy("country", undefined, fe.country)}
            className={inputClass}
          >
            {countries.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </FieldShell>
        <FieldShell id="cocNumber" label={t.fields.cocNumber} hint={t.fields.cocHint} error={fe.cocNumber}>
          <input
            id="cocNumber"
            name="cocNumber"
            maxLength={30}
            defaultValue={text("cocNumber")}
            aria-invalid={fe.cocNumber ? true : undefined}
            aria-describedby={describedBy("cocNumber", t.fields.cocHint, fe.cocNumber)}
            className={cn(inputClass, "font-pf-mono")}
          />
        </FieldShell>
      </div>

      <fieldset id="currentPlatform-group" tabIndex={-1} className="grid min-w-0 gap-2 outline-none" aria-describedby={fe.currentPlatform ? "currentPlatform-error" : undefined}>
        <legend className="mb-2 text-[15px] leading-[1.3] font-medium">{t.fields.currentPlatform}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {platforms.map((p) => (
            <label
              key={p.value}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-2.5 rounded-lg border bg-pf-paper px-3.5 py-2.5 text-base leading-[1.3] transition-colors duration-200 ease-pf-out hover:border-pf-muted",
                "has-[:checked]:border-pf-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-pf-brass",
                fe.currentPlatform ? "border-pf-crit" : "border-pf-line",
              )}
            >
              <input type="radio" name="currentPlatform" value={p.value} defaultChecked={text("currentPlatform") === p.value} className="size-[18px] flex-none focus-visible:outline-none" />
              {p.label}
            </label>
          ))}
        </div>
        {fe.currentPlatform ? <ErrorLine id="currentPlatform-error">{fe.currentPlatform}</ErrorLine> : null}
      </fieldset>

      <FieldShell id="description" label={t.fields.description} hint={t.fields.descriptionHint} error={fe.description}>
        <textarea
          id="description"
          name="description"
          rows={4}
          required
          maxLength={2000}
          defaultValue={text("description")}
          aria-invalid={fe.description ? true : undefined}
          aria-describedby={describedBy("description", t.fields.descriptionHint, fe.description)}
          className={cn(inputClass, "h-auto min-h-[124px] resize-y py-2.5 leading-normal")}
        />
      </FieldShell>

      <div className="grid gap-1.5">
        <label className="flex cursor-pointer items-start gap-3 py-1 text-[15.5px] leading-normal text-pf-ink-2">
          <input
            id="legalConsent"
            type="checkbox"
            name="legalConsent"
            defaultChecked={v.legalConsent === true}
            aria-invalid={fe.legalConsent ? true : undefined}
            aria-describedby={fe.legalConsent ? "legalConsent-error" : undefined}
            className="mt-px size-5 flex-none"
          />
          <span>{t.fields.legalConsent}</span>
        </label>
        {fe.legalConsent ? <ErrorLine id="legalConsent-error">{fe.legalConsent}</ErrorLine> : null}
      </div>

      {/* Light: the platform pages have no dark theme, so a dark widget would clash for dark-mode visitors. */}
      <Turnstile action="apply" resetKey={state?.attempt} theme="light" />
      <Submit label={submitLabel} />
      <p className="-mt-1.5 text-center text-sm text-pf-muted">{footnote}</p>
    </form>
  );
}
