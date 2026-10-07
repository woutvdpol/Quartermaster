"use server";

import { revalidatePath } from "next/cache";
import { actionOk, formString, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { disableUser, enableUser, inviteOwner, resendOwnerInvite, resetUserTwoFactor } from "@/server/users";
import { fail, failFrom } from "../_system/errors";
import { getTenantInfo, inviteLink } from "../_system/tenant";

const PATH = "/admin/users";

export type InviteData = { email: string; link: string; expiresAt: string };

export async function inviteOwnerAction(_prev: ActionState, formData: FormData): Promise<ActionResult<string, InviteData>> {
  const email = formString(formData, "email");
  const name = formString(formData, "name");
  if (!email) return fail("Check the highlighted fields.", { email: ["Enter an e-mail address."] });
  try {
    const ctx = await requireStaffContext();
    const [result, tenant] = await Promise.all([inviteOwner(ctx, { email, name: name || null }), getTenantInfo(ctx.tenantId)]);
    revalidatePath(PATH);
    return actionOk(`Invite created for ${result.user.email}.`, {
      email: result.user.email,
      link: inviteLink(tenant.primaryHost, result.token),
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (err) {
    const failure = failFrom(err);
    return fail(failure.message, failure.fieldErrors ?? (failure.message?.includes("e-mail") ? { email: [failure.message] } : undefined));
  }
}

export async function resendInviteAction(userId: string): Promise<ActionResult<string, InviteData>> {
  try {
    const ctx = await requireStaffContext();
    const [result, tenant] = await Promise.all([resendOwnerInvite(ctx, userId), getTenantInfo(ctx.tenantId)]);
    revalidatePath(PATH);
    return actionOk("New invite link created. The previous link no longer works.", {
      email: "",
      link: inviteLink(tenant.primaryHost, result.token),
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (err) {
    return failFrom(err);
  }
}

export async function disableUserAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    const user = await disableUser(ctx, formString(formData, "id"));
    revalidatePath(PATH);
    return actionOk(`${user.email} is disabled and signed out everywhere.`);
  } catch (err) {
    return failFrom(err);
  }
}

export async function enableUserAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    const user = await enableUser(ctx, formString(formData, "id"));
    revalidatePath(PATH);
    return actionOk(`${user.email} can sign in again.`);
  } catch (err) {
    return failFrom(err);
  }
}

export async function resetTwoFactorAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    const user = await resetUserTwoFactor(ctx, formString(formData, "id"));
    revalidatePath(PATH);
    return actionOk(`Two-factor authentication removed for ${user.email}. They were signed out.`);
  } catch (err) {
    return failFrom(err);
  }
}
