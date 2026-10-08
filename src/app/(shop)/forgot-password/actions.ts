"use server";

import { requestPasswordResetEmail } from "@/server/mail";
// Not while the shop is "coming soon" (src/server/storefront/launch.ts).
import { getOpenShopTenant as getRequestTenant } from "@/server/storefront/launch";
import { clientIp } from "@/server/customer-auth";
import { turnstileTokenFrom, verifyTurnstile } from "@/server/turnstile";
import { accountCopy } from "@/components/shop/account/_copy";

export type ForgotState = { sent?: boolean; error?: string; email?: string } | undefined;

/**
 * Same answer for every address (no account enumeration): unknown/staff/disabled accounts, rate limits
 * and mail failures all look like success. Rate limiting lives in requestPasswordReset (per email);
 * a failed Turnstile check is the only visible error (it says nothing about the address).
 */
export async function forgotPasswordAction(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim().slice(0, 254) : "";
  if (!email) return { error: accountCopy.forgot.missing };
  if (formData.get("website")) return { sent: true }; // honeypot
  const captcha = await verifyTurnstile(turnstileTokenFrom(formData), await clientIp(), { action: "forgot_password" });
  if (!captcha.ok) return { error: accountCopy.common.captcha, email };
  try {
    const tenant = await getRequestTenant();
    if (tenant) await requestPasswordResetEmail(tenant.id, email, "customer");
  } catch (error) {
    console.error("shop forgotPasswordAction failed", error);
  }
  return { sent: true };
}
