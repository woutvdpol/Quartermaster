"use server";

import { revalidatePath } from "next/cache";
import { actionOk, formString, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { removeMollieKey, saveMollieKey, setEnabledMethods, setPaymentSurcharges } from "@/server/payments/mollie-config";
import { methodLabel } from "@/server/payments/method-labels";
import { MAX_SURCHARGE_BPS, MAX_SURCHARGE_FIXED, parsePercentToBps } from "@/server/payments/surcharge";
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

/**
 * Payment surcharges per method. Form fields per method id: `pct.<id>` (percentage text, "5" / "2,5"),
 * `fixed.<id>` and `cap.<id>` (minor units from MoneyInput, "" = none), `label.<id>`.
 * A row with 0% and no fixed amount means "no surcharge".
 */
export async function saveSurchargesAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const ids = [...new Set(formData.getAll("method").filter((m): m is string => typeof m === "string" && /^[a-z0-9]{1,40}$/.test(m)))];
  const errors: Record<string, string[]> = {};
  const rules: Record<string, { percentBps: number; fixed: number; cap: number | null; label: string }> = {};
  const minor = (name: string): number | null | "invalid" => {
    const v = formString(formData, name);
    if (!v) return null;
    return /^\d{1,9}$/.test(v) ? Number(v) : "invalid";
  };
  for (const id of ids) {
    const bps = parsePercentToBps(formString(formData, `pct.${id}`));
    if (bps === null) errors[`pct.${id}`] = ["Enter a percentage like 5 or 2.5."];
    else if (bps > MAX_SURCHARGE_BPS) errors[`pct.${id}`] = [`At most ${MAX_SURCHARGE_BPS / 100}%.`];
    const fixed = minor(`fixed.${id}`);
    if (fixed === "invalid" || (typeof fixed === "number" && fixed > MAX_SURCHARGE_FIXED)) errors[`fixed.${id}`] = ["Enter a valid amount."];
    const cap = minor(`cap.${id}`);
    if (cap === "invalid") errors[`cap.${id}`] = ["Enter a valid amount."];
    if (errors[`pct.${id}`] || errors[`fixed.${id}`] || errors[`cap.${id}`]) continue;
    const percentBps = bps ?? 0;
    const fixedMinor = (fixed as number | null) ?? 0;
    if (percentBps === 0 && fixedMinor === 0) continue; // no surcharge for this method
    const label = formString(formData, `label.${id}`).slice(0, 60) || `${methodLabel(id)} fee`;
    rules[id] = { percentBps, fixed: fixedMinor, cap: cap as number | null, label };
  }
  if (Object.keys(errors).length) return fail("Check the highlighted fields.", errors);
  try {
    const ctx = await requireStaffContext();
    await setPaymentSurcharges(ctx, rules);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(PATH);
  const n = Object.keys(rules).length;
  return actionOk(n ? `Surcharges saved (${n} ${n === 1 ? "method" : "methods"}).` : "Surcharges removed.");
}
