"use server";

import { revalidatePath } from "next/cache";
import { deleteCustomerSearch, updateCustomerSearch } from "@/server/alerts";
import { ServiceError } from "@/server/context";
import { getShopCustomer } from "@/server/customer-auth";
import { shopCopy } from "@/server/i18n/locale";
import { alertsCopies } from "@/components/shop/alerts/_copy";

export type AccountAlertResult = { ok: boolean; message?: string };

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

async function owner() {
  const c = await getShopCustomer();
  return c ? { tenantId: c.tenant.id, customerId: c.customer.id } : null;
}

/**
 * The delivery select: "PUSH" = web push right away, no instant e-mail (docs/push.md); otherwise an
 * e-mail frequency and push off.
 */
function deliveryPatch(name: string, value: string) {
  if (value === "PUSH") return { name, frequency: "INSTANT" as const, push: true };
  return { name, frequency: value as "INSTANT" | "DAILY" | "WEEKLY", push: false };
}

/** Edit name / frequency, pause (`op=pause`) or resume (`op=resume`) one of the customer's alerts. */
export async function updateAccountAlertAction(_prev: AccountAlertResult | null, formData: FormData): Promise<AccountAlertResult> {
  const copy = await shopCopy(alertsCopies);
  const o = await owner();
  if (!o) return { ok: false, message: copy.account.loginAgain };
  const id = str(formData.get("id"));
  const op = str(formData.get("op"));
  try {
    const patch =
      op === "pause"
        ? { active: false }
        : op === "resume"
          ? { active: true }
          : deliveryPatch(str(formData.get("name")), str(formData.get("frequency")));
    const ok = await updateCustomerSearch(o, id, patch);
    revalidatePath("/account/alerts");
    return ok ? { ok: true, message: copy.account.saved } : { ok: false, message: copy.account.notFound };
  } catch (err) {
    if (err instanceof ServiceError) return { ok: false, message: err.message };
    console.error("updateAccountAlertAction failed", err);
    return { ok: false, message: copy.result.error };
  }
}

export async function deleteAccountAlertAction(formData: FormData): Promise<void> {
  const o = await owner();
  if (!o) return;
  await deleteCustomerSearch(o, str(formData.get("id")));
  revalidatePath("/account/alerts");
}
