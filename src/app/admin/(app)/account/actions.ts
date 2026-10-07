"use server";

import { revalidatePath } from "next/cache";
import { actionOk, formString, type ActionResult, type ActionState } from "@/components/admin/ui";
import { changePassword, confirmTotpEnrollment, disableTotp, startTotpEnrollment } from "@/server/auth/service";
import { revokeOtherSessions, revokeSession, updateOwnProfile } from "@/server/users";
import { fail, failFrom } from "../_system/errors";
import { requireAccount } from "./_session";

const PATH = "/admin/account";
const RATE_LIMITED = "Too many attempts. Wait a few minutes and try again.";

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  try {
    const { user } = await requireAccount();
    const email = formString(formData, "email").toLowerCase();
    const emailChanged = email !== "" && email !== user.email;
    const currentPassword = typeof formData.get("currentPassword") === "string" ? String(formData.get("currentPassword")) : "";
    if (!email) return fail("Check the highlighted fields.", { email: ["Enter your e-mail address."] });
    if (emailChanged && !currentPassword) {
      return fail("Check the highlighted fields.", { currentPassword: ["Enter your current password to change your e-mail address."] });
    }
    const res = await updateOwnProfile(user, {
      name: formString(formData, "name"),
      email,
      currentPassword: emailChanged ? currentPassword : undefined,
    });
    if (!res.ok) {
      if (res.error === "invalid_password") return fail("Check the highlighted fields.", { currentPassword: ["That password is not correct."] });
      if (res.error === "email_taken") return fail("Check the highlighted fields.", { email: ["Another account already uses this e-mail address."] });
      return fail(RATE_LIMITED);
    }
    revalidatePath("/admin", "layout");
    return actionOk(emailChanged ? "Profile saved. Use your new e-mail address next time you sign in." : "Profile saved.");
  } catch (err) {
    return failFrom(err);
  }
}

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  const errors: Record<string, string[]> = {};
  if (!current) errors.currentPassword = ["Enter your current password."];
  if (!next) errors.newPassword = ["Choose a new password."];
  else if (next !== confirm) errors.confirmPassword = ["The passwords do not match."];
  if (Object.keys(errors).length) return fail("Check the highlighted fields.", errors);
  try {
    const { user, sessionId } = await requireAccount();
    const res = await changePassword(user, current, next, sessionId);
    if (!res.ok) {
      if (res.error === "invalid_current_password") return fail("Check the highlighted fields.", { currentPassword: ["That password is not correct."] });
      if (res.error === "invalid_password") return fail("Check the highlighted fields.", { newPassword: [res.message ?? "This password is not allowed."] });
      return fail(RATE_LIMITED);
    }
    revalidatePath(PATH);
    return actionOk("Password changed. Your other sessions were signed out.");
  } catch (err) {
    return failFrom(err);
  }
}

/** Generates a TOTP secret to scan. Nothing is stored until the code is confirmed. */
export async function startTotpAction(): Promise<ActionResult<string, { secret: string; uri: string }>> {
  try {
    const { user } = await requireAccount();
    if (user.totpEnabled) return fail("Two-factor authentication is already on.");
    return actionOk(undefined, startTotpEnrollment(user));
  } catch (err) {
    return failFrom(err);
  }
}

export async function confirmTotpAction(_prev: ActionState, formData: FormData): Promise<ActionResult<string, { recoveryCodes: string[] }>> {
  const code = formString(formData, "code").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return fail("Check the highlighted fields.", { code: ["Enter the 6-digit code from your authenticator app."] });
  try {
    const { user } = await requireAccount();
    const res = await confirmTotpEnrollment(user, formString(formData, "secret"), code);
    if (!res.ok) {
      if (res.error === "already_enabled") return fail("Two-factor authentication is already on. Reload the page.");
      if (res.error === "invalid_secret") return fail("The setup expired. Start again.");
      return fail("Check the highlighted fields.", { code: ["That code is not valid. Check the time on your phone and try the next code."] });
    }
    revalidatePath(PATH);
    revalidatePath("/admin/users");
    return actionOk("Two-factor authentication is on.", { recoveryCodes: res.recoveryCodes });
  } catch (err) {
    return failFrom(err);
  }
}

export async function disableTotpAction(formData: FormData): Promise<ActionResult> {
  const password = String(formData.get("password") ?? "");
  if (!password) return fail("Enter your current password.");
  try {
    const { user } = await requireAccount();
    const res = await disableTotp(user, password);
    if (!res.ok) return fail(res.error === "rate_limited" ? RATE_LIMITED : "That password is not correct.");
    revalidatePath(PATH);
    revalidatePath("/admin/users");
    return actionOk("Two-factor authentication is off.");
  } catch (err) {
    return failFrom(err);
  }
}

export async function revokeSessionAction(formData: FormData): Promise<ActionResult> {
  try {
    const { user, sessionId } = await requireAccount();
    const id = formString(formData, "id");
    if (id === sessionId) return fail("This is the session you are using. Sign out instead.");
    await revokeSession(user, id);
    revalidatePath(PATH);
    return actionOk("Session signed out.");
  } catch (err) {
    return failFrom(err);
  }
}

export async function revokeOtherSessionsAction(): Promise<ActionResult> {
  try {
    const { user, sessionId } = await requireAccount();
    const count = await revokeOtherSessions(user, sessionId);
    revalidatePath(PATH);
    return actionOk(count === 0 ? "There were no other sessions." : `Signed out ${count} other ${count === 1 ? "session" : "sessions"}.`);
  } catch (err) {
    return failFrom(err);
  }
}
