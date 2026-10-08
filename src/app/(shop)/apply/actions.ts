"use server";

import { redirect } from "next/navigation";
import { requestClientIp } from "@/server/request-meta";
import { applicationInputFromForm, submitApplication, verifyApplicationEmail, type ApplicationField } from "@/server/onboarding";
import { getRequestScope } from "@/server/tenant";
import { turnstileTokenFrom } from "@/server/turnstile";
import { applyCopy } from "./_copy";

export type ApplyFormValues = Partial<Record<ApplicationField, string | boolean>>;
export type ApplyFormState =
  | { ok: false; error: string; fieldErrors?: Partial<Record<ApplicationField, string>>; values: ApplyFormValues; attempt: number }
  | null;

const t = applyCopy.errors;

/** Dealer sign-up (platform host only). Redirects to /apply/thanks on success. */
export async function submitApplicationAction(prev: ApplyFormState, formData: FormData): Promise<ApplyFormState> {
  const attempt = (prev?.attempt ?? 0) + 1;
  const raw = applicationInputFromForm(formData);
  const values: ApplyFormValues = {
    applicantName: String(raw.applicantName).slice(0, 200),
    email: String(raw.email).slice(0, 254),
    shopName: String(raw.shopName).slice(0, 200),
    country: String(raw.country).slice(0, 2),
    cocNumber: String(raw.cocNumber).slice(0, 40),
    currentPlatform: String(raw.currentPlatform ?? "").slice(0, 40),
    description: String(raw.description).slice(0, 4000),
    legalConsent: raw.legalConsent === true,
  };

  // Honeypot: humans never fill it. Pretend success, store nothing.
  const hp = formData.get("website");
  if (typeof hp === "string" && hp !== "") redirect("/apply/thanks");

  let ok = false;
  try {
    if ((await getRequestScope()).kind !== "platform") return { ok: false, error: t.unexpected, values, attempt };
    const res = await submitApplication({ data: raw, ip: await requestClientIp(), turnstileToken: turnstileTokenFrom(formData) });
    if (!res.ok) {
      if (res.error === "invalid") return { ok: false, error: t.invalid, fieldErrors: res.fieldErrors, values, attempt };
      return { ok: false, error: t[res.error], values, attempt };
    }
    ok = true;
  } catch (error) {
    console.error("submitApplicationAction failed", error);
    return { ok: false, error: t.unexpected, values, attempt };
  }
  if (ok) redirect("/apply/thanks");
  return null;
}

export type VerifyState = { status: "verified" | "already_verified" | "invalid" | "rate_limited" | "error" } | null;

/** POST from /apply/verify (GET never verifies: mail scanners follow links). */
export async function verifyApplicationAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  try {
    if ((await getRequestScope()).kind !== "platform") return { status: "invalid" };
    const status = await verifyApplicationEmail(formData.get("token"), await requestClientIp());
    return { status };
  } catch (error) {
    console.error("verifyApplicationAction failed", error);
    return { status: "error" };
  }
}
