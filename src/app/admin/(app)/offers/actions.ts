"use server";

import { revalidatePath } from "next/cache";
import { actionOk, formString, type ActionResult } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { acceptOffer, counterOffer, rejectOffer } from "@/server/offers";
import { failFrom } from "../_system/errors";
import { offersCopy as t } from "./_copy";

const PATH = "/admin/offers";

export async function acceptOfferAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    await acceptOffer(ctx, formString(formData, "id"), { note: formString(formData, "note") || null });
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  return actionOk(t.actions.accepted);
}

export async function counterOfferAction(formData: FormData): Promise<ActionResult> {
  const amount = Number(formString(formData, "counterAmount"));
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, message: "Enter your price." };
  try {
    const ctx = await requireStaffContext();
    await counterOffer(ctx, formString(formData, "id"), { counterAmount: amount, note: formString(formData, "note") || null });
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  return actionOk(t.actions.countered);
}

export async function rejectOfferAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    await rejectOffer(ctx, formString(formData, "id"), { note: formString(formData, "note") || null });
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  return actionOk(t.actions.rejected);
}
