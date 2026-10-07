"use server";

import { revalidatePath } from "next/cache";
import { actionFail, actionOk, type ActionResult, type ActionState } from "@/components/admin/ui";
import { AuthError } from "@/server/auth/guards";
import { ServiceError, requireStaffContext } from "@/server/context";
import { saveLeadNote, setLeadStatus } from "@/server/leads";
import { copy } from "./_copy";

function fail(error: unknown, field?: string): ActionResult {
  if (error instanceof AuthError) return actionFail(copy.errors.forbidden);
  if (error instanceof ServiceError) {
    if (error.code === "NOT_FOUND") return actionFail(copy.errors.notFound);
    if (error.code === "INVALID") {
      const msg = error.message && error.message !== "INVALID" ? error.message : copy.errors.invalid;
      return actionFail(msg, field ? { [field]: [msg] } : undefined);
    }
  }
  console.error("[admin/leads]", error);
  return actionFail(copy.errors.unexpected);
}

function str(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
}

export async function setLeadStatusAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    await setLeadStatus(ctx, str(formData, "id"), str(formData, "status"));
  } catch (error) {
    return fail(error, "status");
  }
  revalidatePath("/admin/leads");
  return actionOk(copy.saved.status);
}

export async function saveLeadNoteAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    await saveLeadNote(ctx, str(formData, "id"), str(formData, "note"));
  } catch (error) {
    return fail(error, "note");
  }
  revalidatePath("/admin/leads");
  return actionOk(copy.saved.note);
}
