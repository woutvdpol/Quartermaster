"use server";

import { revalidatePath } from "next/cache";
import { actionOk, type ActionResult } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { endFair } from "@/server/fairs";
import { failFrom } from "@/app/admin/(app)/_system/errors";
import { sellCopy as t } from "./_copy";

/**
 * "End fair" from fair mode. endFair is not module-gated, so a shop that lost the "fairs" module can
 * still end a live fair here (its /admin/fairs screens show the module gate instead).
 */
export async function endFairFromSellAction(fairId: string): Promise<ActionResult> {
  try {
    await endFair(await requireStaffContext(), fairId);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath("/admin/fairs");
  revalidatePath(`/admin/fairs/${fairId}`);
  return actionOk(t.end.done);
}
