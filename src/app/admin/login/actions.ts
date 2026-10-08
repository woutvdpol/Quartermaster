"use server";

import { redirect } from "next/navigation";
import { login, logout, verifyLoginTotp } from "@/server/auth/service";
import { getRequestScope } from "@/server/tenant";
import { safeAdminRedirect } from "@/lib/admin-nav";
import { getDictionary } from "@/lib/i18n";
import { isSetupPending } from "@/server/onboarding/setup-rules";

export type LoginFormState = { error?: string; email?: string } | undefined;
export type TotpFormState = { error?: string; restart?: boolean } | undefined;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function loginAction(_prev: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const t = getDictionary().login.errors;
  const email = field(formData, "email").trim();
  const password = field(formData, "password");
  let next = safeAdminRedirect(field(formData, "next"));
  if (!email || !password) return { error: t.missing, email };

  let result: Awaited<ReturnType<typeof login>>;
  let setupPending = false;
  try {
    // Platform host → SUPERADMIN login; a shop's own host → that shop's OWNER.
    // Unknown hosts get the same generic error as wrong credentials.
    const scope = await getRequestScope();
    if (scope.kind === "unknown") return { error: t.invalid_credentials, email };
    result = await login({ email, password, tenantId: scope.kind === "tenant" ? scope.tenant.id : null });
    setupPending = scope.kind === "tenant" && isSetupPending(scope.tenant);
  } catch (error) {
    console.error("loginAction failed", error);
    return { error: t.unexpected, email };
  }

  if (!result.ok) return { error: t[result.error], email };
  // A shop that has not finished onboarding opens the setup wizard instead of the dashboard.
  if (next === "/admin/dashboard" && setupPending) next = "/admin/setup";
  if (result.next === "totp") {
    redirect(next === "/admin/dashboard" ? "/admin/login/2fa" : `/admin/login/2fa?next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export async function verifyTotpAction(_prev: TotpFormState, formData: FormData): Promise<TotpFormState> {
  const t = getDictionary().twoFactor.errors;
  const code = field(formData, "code").trim();
  const next = safeAdminRedirect(field(formData, "next"));
  if (!code) return { error: t.missing };

  let result: Awaited<ReturnType<typeof verifyLoginTotp>>;
  try {
    result = await verifyLoginTotp(code);
  } catch (error) {
    console.error("verifyTotpAction failed", error);
    return { error: t.unexpected };
  }

  if (!result.ok) {
    // After too many attempts or an expired pending session the user must start over.
    return { error: t[result.error], restart: result.error !== "invalid_code" };
  }
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/admin/login");
}
