"use server";

import { getRequestTenant } from "@/server/tenant";
import { getShopCustomer } from "@/server/customer-auth/current";
import { sendCustomerVerification, verifyCustomerEmail } from "@/server/email-verification";
import { verifyCopy as t } from "./_copy";

export type VerifyState = { ok?: boolean; message?: string; invalid?: boolean } | undefined;

/** POST only: mail scanners follow GET links, so opening the link never verifies by itself. */
export async function verifyEmailAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const token = String(formData.get("token") ?? "").slice(0, 200);
  try {
    const tenant = await getRequestTenant();
    if (!tenant) return { invalid: true, message: t.invalid };
    // Bound to this shop: a token issued by another shop is "invalid" here.
    const res = await verifyCustomerEmail(tenant.id, token);
    return res.ok ? { ok: true, message: t.done(res.email) } : { invalid: true, message: t.invalid };
  } catch (error) {
    console.error("verifyEmailAction failed", error);
    return { message: t.unexpected };
  }
}

/** Re-sends the verification mail to the signed-in customer of this shop. */
export async function resendVerificationAction(): Promise<VerifyState> {
  try {
    const me = await getShopCustomer();
    if (!me) return { message: t.loginToResend };
    const res = await sendCustomerVerification(me.tenant.id, me.user.id);
    if (res.sent) return { ok: true, message: t.resent };
    if (res.reason === "already_verified") return { ok: true, message: t.alreadyVerified };
    if (res.reason === "rate_limited") return { message: t.rateLimited };
    return { message: t.unexpected };
  } catch (error) {
    console.error("resendVerificationAction failed", error);
    return { message: t.unexpected };
  }
}
