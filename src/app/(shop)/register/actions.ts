"use server";

import { redirect } from "next/navigation";
import { clientIp, DEFAULT_AFTER_LOGIN, registerCustomer, safeShopRedirect } from "@/server/customer-auth";
import { localeHref, shopCopy } from "@/server/i18n/locale";
// Not while the shop is "coming soon" (src/server/storefront/launch.ts).
import { getOpenShopTenant as getRequestTenant } from "@/server/storefront/launch";
import { turnstileTokenFrom, verifyTurnstile } from "@/server/turnstile";
import { accountCopies } from "@/components/shop/account/_copy";

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
  const copy = await shopCopy(accountCopies);
  const t = copy.register.errors;
  const values = {
    email: field(formData, "email").trim().slice(0, 254),
    name: field(formData, "name").trim().slice(0, 200),
    newsletter: formData.get("newsletter") === "on",
  };
  const password = field(formData, "password");
  // `next` already carries its language prefix; the fallback is the account page in this language.
  const next = safeShopRedirect(field(formData, "next"), await localeHref(DEFAULT_AFTER_LOGIN));

  // Honeypot: a filled hidden field means a bot. Answer like a generic failure, create nothing.
  if (field(formData, "website")) return { error: copy.common.unexpected, values };

  let result: Awaited<ReturnType<typeof registerCustomer>>;
  try {
    const tenant = await getRequestTenant();
    if (!tenant) return { error: copy.common.unexpected, values };
    const ip = await clientIp();
    const captcha = await verifyTurnstile(turnstileTokenFrom(formData), ip, { action: "register" });
    if (!captcha.ok) return { error: copy.common.captcha, values };
    result = await registerCustomer({ tenantId: tenant.id, ...values, password, ip });
  } catch (error) {
    console.error("registerAction failed", error);
    return { error: copy.common.unexpected, values };
  }
  if (!result.ok) return { error: t[result.error], fieldErrors: result.fieldErrors, values };
  redirect(next);
}
