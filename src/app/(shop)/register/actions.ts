"use server";

import { redirect } from "next/navigation";
import { clientIp, registerCustomer, safeShopRedirect } from "@/server/customer-auth";
import { getRequestTenant } from "@/server/tenant";
import { turnstileTokenFrom, verifyTurnstile } from "@/server/turnstile";
import { accountCopy } from "@/components/shop/account/_copy";

export type RegisterState =
  | {
      error?: string;
      fieldErrors?: Partial<Record<"email" | "name" | "password", string>>;
      values?: { email: string; name: string; newsletter: boolean };
    }
  | undefined;

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

export async function registerAction(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const t = accountCopy.register.errors;
  const values = {
    email: field(formData, "email").trim().slice(0, 254),
    name: field(formData, "name").trim().slice(0, 200),
    newsletter: formData.get("newsletter") === "on",
  };
  const password = field(formData, "password");
  const next = safeShopRedirect(field(formData, "next"));

  // Honeypot: a filled hidden field means a bot. Answer like a generic failure, create nothing.
  if (field(formData, "website")) return { error: accountCopy.common.unexpected, values };

  let result: Awaited<ReturnType<typeof registerCustomer>>;
  try {
    const tenant = await getRequestTenant();
    if (!tenant) return { error: accountCopy.common.unexpected, values };
    const ip = await clientIp();
    const captcha = await verifyTurnstile(turnstileTokenFrom(formData), ip, { action: "register" });
    if (!captcha.ok) return { error: accountCopy.common.captcha, values };
    result = await registerCustomer({ tenantId: tenant.id, ...values, password, ip });
  } catch (error) {
    console.error("registerAction failed", error);
    return { error: accountCopy.common.unexpected, values };
  }
  if (!result.ok) return { error: t[result.error], fieldErrors: result.fieldErrors, values };
  redirect(next);
}
