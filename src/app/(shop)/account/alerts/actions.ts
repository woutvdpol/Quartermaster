"use server";

import { revalidatePath } from "next/cache";
import { deleteCustomerSearch, updateCustomerSearch } from "@/server/alerts";
import { ServiceError } from "@/server/context";
import { getShopCustomer } from "@/server/customer-auth";

export type AccountAlertResult = { ok: boolean; message?: string };

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

async function owner() {
  const c = await getShopCustomer();
  return c ? { tenantId: c.tenant.id, customerId: c.customer.id } : null;
}

/** Edit name / frequency, pause (`op=pause`) or resume (`op=resume`) one of the customer's alerts. */
export async function updateAccountAlertAction(_prev: AccountAlertResult | null, formData: FormData): Promise<AccountAlertResult> {
  const o = await owner();
  if (!o) return { ok: false, message: "Please log in again." };
  const id = str(formData.get("id"));
  const op = str(formData.get("op"));
  try {
    const patch =
      op === "pause"
        ? { active: false }
        : op === "resume"
          ? { active: true }
          : { name: str(formData.get("name")), frequency: str(formData.get("frequency")) as "INSTANT" | "DAILY" | "WEEKLY" };
    const ok = await updateCustomerSearch(o, id, patch);
    revalidatePath("/account/alerts");
    return ok ? { ok: true, message: "Saved." } : { ok: false, message: "Alert not found." };
  } catch (err) {
    if (err instanceof ServiceError) return { ok: false, message: err.message };
    console.error("updateAccountAlertAction failed", err);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function deleteAccountAlertAction(formData: FormData): Promise<void> {
  const o = await owner();
  if (!o) return;
  await deleteCustomerSearch(o, str(formData.get("id")));
  revalidatePath("/account/alerts");
}
