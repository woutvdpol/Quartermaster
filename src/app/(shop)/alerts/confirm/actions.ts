"use server";

import { localeRedirect } from "@/server/i18n/locale";
import { confirmSavedSearch } from "@/server/alerts";
import { getRequestTenant } from "@/server/tenant";

/** Double opt-in: only this POST (the visitor's button click) confirms — GET links are fetched by scanners. */
export async function confirmAlertAction(formData: FormData): Promise<void> {
  const raw = formData.get("token");
  const token = typeof raw === "string" ? raw : "";
  let status: "confirmed" | "invalid" | "expired" = "invalid";
  try {
    const tenant = await getRequestTenant();
    if (tenant) {
      const res = await confirmSavedSearch(token, { tenantId: tenant.id });
      status = res.ok ? "confirmed" : res.error;
    }
  } catch (error) {
    console.error("confirmAlertAction failed", error);
  }
  await localeRedirect(`/alerts?status=${status}`);
}
