"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Turnstile } from "@/components/shop/turnstile/Turnstile";
import { platformButtonClass } from "../_platform/PlatformShell";
import { submitApplicationAction, type ApplyFormState } from "./actions";
import { applyCopy } from "./_copy";

const t = applyCopy;

const inputClass =
  "w-full rounded-md border border-[#D7D8CC] bg-white px-3 py-2.5 text-[15px] text-[#1E2119] placeholder:text-[#8a8d7c] " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#7E5416] aria-invalid:border-[#a23a2a]";

type Option = { value: string; label: string };

function FieldShell({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-[#666A5A]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-[#a23a2a]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint?: string, error?: string) {
  return [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`${platformButtonClass} w-full`} disabled={pending} aria-disabled={pending}>
      {pending ? t.submitting : t.submit}
    </button>
  );
}

export function ApplyForm({ countries, platforms }: { countries: Option[]; platforms: Option[] }) {
  const [state, formAction] = useActionState<ApplyFormState, FormData>(submitApplicationAction, null);
  const v = state?.values ?? {};
  const fe = state?.fieldErrors ?? {};
  const text = (name: keyof typeof v) => (typeof v[name] === "string" ? (v[name] as string) : "");

  return (
    // Re-mount after each failed attempt so the typed values come back as defaults (React resets form fields).
    <form key={state?.attempt ?? 0} action={formAction} noValidate className="grid gap-4">
      {state?.error ? (
        <p role="alert" className="rounded-md border border-[#e3c3b9] bg-[#fbeee9] px-3 py-2.5 text-sm text-[#7a2a1c]">
          {state.error}
        </p>
      ) : null}

      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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

      <div className="grid gap-4 sm:grid-cols-2">
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
            className={`${inputClass} font-mono`}
          />
        </FieldShell>
      </div>

      <fieldset className="grid gap-2" aria-describedby={fe.currentPlatform ? "currentPlatform-error" : undefined}>
        <legend className="mb-1.5 text-sm font-medium">{t.fields.currentPlatform}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {platforms.map((p) => (
            <label
              key={p.value}
              className="flex cursor-pointer items-center gap-2.5 rounded-md border border-[#D7D8CC] bg-white px-3 py-2.5 text-sm has-[:checked]:border-[#7E5416] has-[:checked]:bg-[#f6efe3]"
            >
              <input type="radio" name="currentPlatform" value={p.value} defaultChecked={text("currentPlatform") === p.value} className="accent-[#7E5416]" />
              {p.label}
            </label>
          ))}
        </div>
        {fe.currentPlatform ? (
          <p id="currentPlatform-error" className="text-xs font-medium text-[#a23a2a]">
            {fe.currentPlatform}
          </p>
        ) : null}
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
          className={inputClass}
        />
      </FieldShell>

      <div className="grid gap-1.5">
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="legalConsent"
            defaultChecked={v.legalConsent === true}
            aria-invalid={fe.legalConsent ? true : undefined}
            aria-describedby={fe.legalConsent ? "legalConsent-error" : undefined}
            className="mt-0.5 size-4 accent-[#7E5416]"
          />
          <span>{t.fields.legalConsent}</span>
        </label>
        {fe.legalConsent ? (
          <p id="legalConsent-error" className="text-xs font-medium text-[#a23a2a]">
            {fe.legalConsent}
          </p>
        ) : null}
      </div>

      <Turnstile action="apply" resetKey={state?.attempt} />
      <Submit />
      <p className="text-center text-xs text-[#666A5A]">{t.footnote}</p>
    </form>
  );
}
