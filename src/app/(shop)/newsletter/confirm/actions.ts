"use server";

import { localeRedirect } from "@/server/i18n/locale";
import { confirmSubscription } from "@/server/newsletter";
import { getRequestTenant } from "@/server/tenant";

/**
 * Double opt-in confirmation. Only a POST (this server action, triggered by the visitor's button
 * click) changes state — GET links are fetched by mail scanners and must never confirm.
 */
export async function confirmNewsletterAction(formData: FormData): Promise<void> {
  const raw = formData.get("token");
  const token = typeof raw === "string" ? raw : "";
  let status: "confirmed" | "invalid" | "expired" = "invalid";
  try {
    const tenant = await getRequestTenant();
    if (tenant) {
      const result = await confirmSubscription(token, { tenantId: tenant.id });
      status = result.ok ? "confirmed" : result.error;
    }
  } catch (error) {
    console.error("confirmNewsletterAction failed", error);
  }
  await localeRedirect(`/newsletter?status=${status}`);
}
