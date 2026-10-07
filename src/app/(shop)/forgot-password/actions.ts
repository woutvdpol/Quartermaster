"use server";

import { requestPasswordResetEmail } from "@/server/mail";
import { getRequestTenant } from "@/server/tenant";
import { accountCopy } from "@/components/shop/account/_copy";

export type ForgotState = { sent?: boolean; error?: string; email?: string } | undefined;

/**
 * Same answer for every address (no account enumeration): unknown/staff/disabled accounts, rate limits
 * and mail failures all look like success. Rate limiting lives in requestPasswordReset (per email).
 */
export async function forgotPasswordAction(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim().slice(0, 254) : "";
  if (!email) return { error: accountCopy.forgot.missing };
  if (formData.get("website")) return { sent: true }; // honeypot
  try {
    const tenant = await getRequestTenant();
    if (tenant) await requestPasswordResetEmail(tenant.id, email, "customer");
  } catch (error) {
    console.error("shop forgotPasswordAction failed", error);
  }
  return { sent: true };
}
