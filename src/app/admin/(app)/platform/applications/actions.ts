"use server";

import { revalidatePath } from "next/cache";
import { actionOk, formString, type ActionResult, type ActionState } from "@/components/admin/ui";
import { approveApplication, rejectApplication, resendDealerInvite, saveApplicationNote } from "@/server/onboarding";
import { requirePlatformContext } from "@/server/platform";
import { fail, failFrom } from "../../_system/errors";

const BASE = "/admin/platform/applications";

export async function saveApplicationNoteAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePlatformContext();
    await saveApplicationNote(ctx, formString(formData, "id"), formString(formData, "note"));
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(BASE);
  return actionOk("Note saved.");
}

export async function rejectApplicationAction(formData: FormData): Promise<ActionResult> {
  const reason = formString(formData, "reason");
  if (reason.length < 3) return fail("Give a reason (it is sent to the applicant).", { reason: ["Give a reason."] });
  try {
    const ctx = await requirePlatformContext();
    await rejectApplication(ctx, formString(formData, "id"), reason);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(BASE, "layout");
  return actionOk("Application rejected. The applicant gets an email with the reason.");
}

export async function approveApplicationAction(formData: FormData): Promise<ActionResult> {
  let host: string;
  try {
    const ctx = await requirePlatformContext();
    const res = await approveApplication(ctx, formString(formData, "id"));
    host = res.domain.host;
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(BASE, "layout");
  revalidatePath("/admin", "layout"); // tenant switcher
  return actionOk(`Shop created at ${host}. The owner invite (24 h) is on its way.`);
}

export async function resendDealerInviteAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePlatformContext();
    await resendDealerInvite(ctx, formString(formData, "id"));
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(BASE);
  return actionOk("A new invite link (24 h) has been sent.");
}
