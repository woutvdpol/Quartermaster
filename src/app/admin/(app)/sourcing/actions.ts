"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionFail, actionOk, zodFieldErrors, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { createPurchaseRecord, updatePurchaseRecord } from "@/server/purchasing";
import { copy } from "./_copy";
import { failFrom } from "./_lib/errors";
import { isYmd } from "./_lib/time";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .transform((v) => v || null);

const recordForm = z.object({
  purchasedAt: z.string().refine(isYmd, copy.form.dateRequired),
  supplierId: optionalText(64),
  invoiceNumber: optionalText(100),
  totalCost: z
    .string()
    .trim()
    .transform((v, c) => {
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        c.addIssue({ code: "custom", message: "Enter an amount of zero or more." });
        return z.NEVER;
      }
      return n;
    }),
  notes: optionalText(5000),
});

function parseRecordForm(formData: FormData) {
  return recordForm.safeParse({
    purchasedAt: String(formData.get("purchasedAt") ?? ""),
    supplierId: String(formData.get("supplierId") ?? ""),
    invoiceNumber: String(formData.get("invoiceNumber") ?? ""),
    totalCost: String(formData.get("totalCost") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
}

export async function createRecordAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const parsed = parseRecordForm(formData);
  if (!parsed.success) return actionFail(copy.form.checkFields, zodFieldErrors(parsed.error));
  let id: string;
  try {
    const ctx = await requireStaffContext();
    const r = await createPurchaseRecord(ctx, { ...parsed.data, purchasedAt: `${parsed.data.purchasedAt}T00:00:00Z` });
    id = r.id;
  } catch (e) {
    return failFrom(e, { NOT_FOUND: "That supplier no longer exists. Pick another one." });
  }
  revalidatePath("/admin/sourcing", "layout");
  redirect(`/admin/sourcing/records/${id}`);
}

export async function updateRecordAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  if (!id) return actionFail("Missing record.");
  const parsed = parseRecordForm(formData);
  if (!parsed.success) return actionFail(copy.form.checkFields, zodFieldErrors(parsed.error));
  try {
    const ctx = await requireStaffContext();
    await updatePurchaseRecord(ctx, id, { ...parsed.data, purchasedAt: `${parsed.data.purchasedAt}T00:00:00Z` });
  } catch (e) {
    return failFrom(e, { NOT_FOUND: "This record or its supplier no longer exists. Reload the page." });
  }
  revalidatePath("/admin/sourcing", "layout");
  return actionOk(copy.form.saved);
}
