"use server";

import { redirect } from "next/navigation";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { acceptDealerInvite } from "@/server/onboarding/invite";
import { requestClientIp } from "@/server/request-meta";
import { getRequestScope } from "@/server/tenant";
import { copy } from "./_copy";

export type AcceptInviteState =
  | { status: "invalid_token" }
  | { status: "error"; error: string; field?: "password" | "confirm" }
  | undefined;

/** Redeems an INVITE token on the shop's own host, signs the owner in and opens the setup wizard. */
export async function acceptInviteAction(_prev: AcceptInviteState, formData: FormData): Promise<AcceptInviteState> {
  const token = formData.get("token");
  const password = formData.get("password");
  const confirm = formData.get("confirm");
  if (typeof token !== "string" || !token) return { status: "invalid_token" };
  if (typeof password !== "string" || typeof confirm !== "string" || !password || !confirm) {
    return { status: "error", error: copy.errors.missing, field: !password ? "password" : "confirm" };
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { status: "error", error: copy.errors.tooShort(MIN_PASSWORD_LENGTH), field: "password" };
  }
  if (password !== confirm) return { status: "error", error: copy.errors.mismatch, field: "confirm" };

  try {
    // Invites only work on the shop's own host (never on the platform host).
    const scope = await getRequestScope();
    if (scope.kind !== "tenant") return { status: "invalid_token" };
    const result = await acceptDealerInvite(token, password, { tenantId: scope.tenant.id, ip: await requestClientIp() });
    if (!result.ok) {
      if (result.error === "invalid_token") return { status: "invalid_token" };
      if (result.error === "rate_limited") return { status: "error", error: copy.errors.rate_limited };
      return { status: "error", error: result.message ?? copy.errors.tooShort(MIN_PASSWORD_LENGTH), field: "password" };
    }
  } catch (error) {
    console.error("acceptInviteAction failed", error);
    return { status: "error", error: copy.errors.unexpected };
  }
  redirect("/admin/setup");
}
