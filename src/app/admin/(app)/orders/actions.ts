"use server";

import { revalidatePath } from "next/cache";
import { actionFail, actionOk, type ActionResult } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { archiveOrder } from "@/server/orders/commands";
import { ordersCopy as t } from "./_copy";
import { failFromError, idsFrom } from "./_lib/errors";

/** Bulk archive from the order list (ConfirmDialog). Orders are never deleted — archive only. */
export async function archiveOrdersAction(formData: FormData): Promise<ActionResult> {
  const ids = idsFrom(formData);
  if (ids.length === 0) return actionFail(t.bulk.none);
  try {
    const ctx = await requireStaffContext();
    let archived = 0;
    for (const id of ids) {
      const { changed } = await archiveOrder(ctx, id);
      if (changed) archived++;
    }
    revalidatePath("/admin/orders");
    revalidatePath("/admin/shipping-board");
    return actionOk(t.bulk.done(archived));
  } catch (error) {
    revalidatePath("/admin/orders");
    return failFromError(error, t.notFound);
  }
}
