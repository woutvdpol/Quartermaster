"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, actionOk, zodFieldErrors, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { createSupplier, deleteSupplier, updateSupplier } from "@/server/purchasing";
import { copy } from "../_copy";
import { failFrom } from "../_lib/errors";

const supplierForm = z.object({
  name: z.string().trim().min(1, copy.suppliers.nameRequired).max(200, "Use at most 200 characters."),
  contact: z.string().trim().max(1000, "Use at most 1000 characters."),
  notes: z.string().trim().max(5000, "Use at most 5000 characters."),
});

export async function saveSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const parsed = supplierForm.safeParse({
    name: String(formData.get("name") ?? ""),
    contact: String(formData.get("contact") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) return actionFail("Check the highlighted fields.", zodFieldErrors(parsed.error));
  try {
    const ctx = await requireStaffContext();
    if (id) await updateSupplier(ctx, id, parsed.data);
    else await createSupplier(ctx, parsed.data);
  } catch (e) {
    const res = failFrom(e, { CONFLICT: copy.suppliers.duplicate });
    if (!res.ok && res.message === copy.suppliers.duplicate) return actionFail(res.message, { name: [copy.suppliers.duplicate] });
    return res;
  }
  revalidatePath("/admin/sourcing", "layout");
  return actionOk(id ? copy.suppliers.saved : copy.suppliers.created);
}

export async function deleteSupplierAction(formData: FormData): Promise<ActionResult> {
  const id = z.string().trim().min(1).max(64).safeParse(formData.get("id"));
  if (!id.success) return actionFail("Missing supplier.");
  try {
    const ctx = await requireStaffContext();
    await deleteSupplier(ctx, id.data);
  } catch (e) {
    return failFrom(e, { CONFLICT: copy.suppliers.inUse });
  }
  revalidatePath("/admin/sourcing", "layout");
  return actionOk(copy.suppliers.deleted);
}
