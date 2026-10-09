"use server";

import { localeRedirect } from "@/server/i18n/locale";
import { stopFromManageLink } from "@/server/alerts";
import { getRequestTenant } from "@/server/tenant";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.slice(0, 128) : "");

/** Stops one alert (`target`) or all alerts of the address behind a signed manage link. */
export async function stopManagedAlertAction(formData: FormData): Promise<void> {
  const tenantId = str(formData.get("t"));
  const savedSearchId = str(formData.get("s"));
  const sig = str(formData.get("sig"));
  const target = str(formData.get("target")) || null;
  let ok = false;
  try {
    const tenant = await getRequestTenant();
    if (tenant && tenant.id === tenantId) ok = (await stopFromManageLink({ tenantId, savedSearchId, sig, targetId: target })).ok;
  } catch (error) {
    console.error("stopManagedAlertAction failed", error);
  }
  if (!ok) await localeRedirect("/alerts?status=invalid");
  await localeRedirect(`/alerts/manage?${new URLSearchParams({ t: tenantId, s: savedSearchId, sig })}`);
}
