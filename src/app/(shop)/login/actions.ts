"use server";

import { redirect } from "next/navigation";
import { verifyLoginTotp } from "@/server/auth/service";
import { destroySession } from "@/server/auth/session";
import { clientIp, customerLogin, hasPendingCustomerTotp, safeShopRedirect } from "@/server/customer-auth";
import { getRequestTenant } from "@/server/tenant";
import { accountCopy } from "@/components/shop/account/_copy";

export type LoginState = { error?: string; email?: string } | undefined;
export type TotpState = { error?: string; restart?: boolean } | undefined;

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

export async function shopLoginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = accountCopy.login.errors;
  const email = field(formData, "email").trim().slice(0, 254);
  const password = field(formData, "password");
  const next = safeShopRedirect(field(formData, "next"));
  if (!email || !password) return { error: t.missing, email };

  let result: Awaited<ReturnType<typeof customerLogin>>;
  try {
    const tenant = await getRequestTenant();
    // Customer accounts only exist on a shop host; anywhere else it is just "wrong credentials".
    if (!tenant) return { error: t.invalid_credentials, email };
    result = await customerLogin({ tenantId: tenant.id, email, password, ip: await clientIp() });
  } catch (error) {
    console.error("shopLoginAction failed", error);
    return { error: accountCopy.common.unexpected, email };
  }
  if (!result.ok) return { error: t[result.error], email };
  if (result.next === "totp") redirect(`/login/2fa?next=${encodeURIComponent(next)}`);
  redirect(next);
}

export async function shopVerifyTotpAction(_prev: TotpState, formData: FormData): Promise<TotpState> {
  const t = accountCopy.twoFactor.errors;
  const code = field(formData, "code").trim();
  const next = safeShopRedirect(field(formData, "next"));
  if (!code) return { error: t.missing };
  let result: Awaited<ReturnType<typeof verifyLoginTotp>>;
  try {
    // Only finish pending sessions of this shop's customers (not a pending staff login).
    if (!(await hasPendingCustomerTotp())) return { error: t.no_pending_session, restart: true };
    result = await verifyLoginTotp(code);
  } catch (error) {
    console.error("shopVerifyTotpAction failed", error);
    return { error: accountCopy.common.unexpected };
  }
  if (!result.ok) return { error: t[result.error], restart: result.error !== "invalid_code" };
  redirect(next);
}

/** Abandons a pending 2FA login and returns to the login form. */
export async function cancelTotpAction(): Promise<void> {
  if (await hasPendingCustomerTotp()) await destroySession();
  redirect("/login");
}
