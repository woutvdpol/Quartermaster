"use server";

import { revalidatePath } from "next/cache";
import { actionFail, actionOk, formString, type ActionResult } from "@/components/admin/ui";
import { adminDisableSavedSearch, runMatchingNow } from "@/server/alerts";
import { requireStaffContext } from "@/server/context";
import { copy } from "./_copy";

const BASE = "/admin/alerts";

export async function disableAlertAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  const ok = await adminDisableSavedSearch(ctx, formString(formData, "id"));
  revalidatePath(BASE);
  return ok ? actionOk(copy.disabled) : actionFail(copy.notFound);
}

export async function runMatchingAction(): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  try {
    const r = await runMatchingNow(ctx, { days: 7 });
    revalidatePath(BASE);
    return actionOk(copy.runDone(r.created, r.instantMails + r.digestMails));
  } catch (err) {
    console.error("runMatchingAction failed", err);
    return actionFail("Matching failed. Try again later.");
  }
}
