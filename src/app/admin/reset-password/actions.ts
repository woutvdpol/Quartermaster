"use server";

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/server/auth/password";
import { resetPassword } from "@/server/auth/service";
import { copy } from "./_copy";
import { getRequestScope } from "@/server/tenant";

export type ResetPasswordState =
  | { status: "done" }
  | { status: "invalid_token" }
  | { status: "error"; error: string; field?: "password" | "confirm" }
  | undefined;

/** Redeems a PASSWORD_RESET token (also used for owner invites) and sets the new password. */
export async function resetPasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const token = formData.get("token");
  const password = formData.get("password");
  const confirm = formData.get("confirm");
  if (typeof token !== "string" || !token) return { status: "invalid_token" };
  if (
    typeof password !== "string" ||
    typeof confirm !== "string" ||
    !password ||
    !confirm
  ) {
    return {
      status: "error",
      error: copy.errors.missing,
      field: !password ? "password" : "confirm",
    };
  }
  if (
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return {
      status: "error",
      error: copy.errors.tooShort(MIN_PASSWORD_LENGTH),
      field: "password",
    };
  }
  if (password !== confirm)
    return { status: "error", error: copy.errors.mismatch, field: "confirm" };

  try {
    // Tokens only work on the host they belong to (platform vs. the shop's own domain).
    const scope = await getRequestScope();
    if (scope.kind === "unknown") return { status: "invalid_token" };
    const result = await resetPassword(token, password, { tenantId: scope.kind === "tenant" ? scope.tenant.id : null });
    if (result.ok) return { status: "done" };
    if (result.error === "invalid_token") return { status: "invalid_token" };
    return {
      status: "error",
      error: result.message ?? copy.errors.tooShort(MIN_PASSWORD_LENGTH),
      field: "password",
    };
  } catch (error) {
    console.error("resetPasswordAction failed", error);
    return { status: "error", error: copy.errors.unexpected };
  }
}
