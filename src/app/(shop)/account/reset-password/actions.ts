"use server";

import { resetPassword } from "@/server/auth/service";
import { getRequestTenant } from "@/server/tenant";
import { localeRedirect, shopCopy } from "@/server/i18n/locale";
import { accountCopies } from "@/components/shop/account/_copy";

export type ResetState = { error?: string; invalidToken?: boolean } | undefined;

export async function resetPasswordAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const accountCopy = await shopCopy(accountCopies);
  const t = accountCopy.reset;
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) return { error: t.mismatch };

  let result: Awaited<ReturnType<typeof resetPassword>>;
  try {
    const tenant = await getRequestTenant();
    if (!tenant) return { error: t.invalidToken, invalidToken: true };
    // Bound to this shop: a token of another shop (or the platform) is "invalid" here.
    result = await resetPassword(token, password, { tenantId: tenant.id });
  } catch (error) {
    console.error("shop resetPasswordAction failed", error);
    return { error: accountCopy.common.unexpected };
  }
  if (!result.ok) {
    return result.error === "invalid_token"
      ? { error: t.invalidToken, invalidToken: true }
      : { error: result.message ?? accountCopy.profile.passwordErrors.invalid_password };
  }
  await localeRedirect("/login?reset=1");
}
