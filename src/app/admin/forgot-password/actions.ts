"use server";

import { requestPasswordResetEmail } from "@/server/mail";
import { getRequestScope } from "@/server/tenant";
import { copy } from "./_copy";

export type ForgotPasswordState =
  { sent?: boolean; error?: string; email?: string } | undefined;

/**
 * Always answers the same way once an address was entered (no account enumeration): unknown host,
 * unknown address, disabled account, rate limit and mail failures all look like success.
 * Platform host → SUPERADMIN accounts; a shop's own host → that shop's OWNER accounts.
 */
export async function forgotPasswordAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim().slice(0, 254) : "";
  if (!email) return { error: copy.missing };
  try {
    const scope = await getRequestScope();
    if (scope.kind !== "unknown") {
      await requestPasswordResetEmail(
        scope.kind === "tenant" ? scope.tenant.id : null,
        email,
        "admin",
      );
    }
  } catch (error) {
    console.error("forgotPasswordAction failed", error);
  }
  return { sent: true };
}
