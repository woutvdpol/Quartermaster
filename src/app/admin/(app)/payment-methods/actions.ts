"use server";

import { revalidatePath } from "next/cache";
import { actionOk, formString, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { removeMollieKey, saveMollieKey, setEnabledMethods } from "@/server/payments/mollie-config";
import { fail, failFrom } from "../_system/errors";

const PATH = "/admin/payment-methods";

export async function saveMollieKeyAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const key = formString(formData, "apiKey");
  if (!key) return fail("Check the highlighted fields.", { apiKey: ["Paste your Mollie API key."] });
  try {
    const ctx = await requireStaffContext();
    const status = await saveMollieKey(ctx, key);
    revalidatePath(PATH);
    return actionOk(`Mollie connected in ${status.mode === "live" ? "live" : "test"} mode.`);
  } catch (err) {
    const failure = failFrom(err);
    return fail(failure.message, failure.fieldErrors ?? { apiKey: [failure.message ?? "This key was not accepted."] });
  }
}

export async function removeMollieKeyAction(): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    await removeMollieKey(ctx);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  return actionOk("Mollie disconnected. Checkout cannot take payments until you connect a key again.");
}

export async function saveMethodsAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const mode = formString(formData, "mode");
  const methods = mode === "all" ? [] : formData.getAll("methods").filter((m): m is string => typeof m === "string");
  if (mode !== "all" && methods.length === 0) {
    return fail("Select at least one method, or choose to offer all methods.", { methods: ["Select at least one method."] });
  }
  try {
    const ctx = await requireStaffContext();
    await setEnabledMethods(ctx, methods);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  return actionOk("Payment methods saved.");
}
