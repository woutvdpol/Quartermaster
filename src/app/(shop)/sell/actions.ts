"use server";

import { leadsCopy } from "@/components/shop/leads/_copy";
import type { SellFormState } from "@/components/shop/leads/types";
import { clientIp } from "@/server/customer-auth";
import { leadInputFromForm, submitLead } from "@/server/leads";
// Not while the shop is "coming soon" (src/server/storefront/launch.ts).
import { getOpenShopTenant as getRequestTenant } from "@/server/storefront/launch";
import { turnstileTokenFrom } from "@/server/turnstile";

const t = leadsCopy.errors;

export async function submitLeadAction(prev: SellFormState, formData: FormData): Promise<SellFormState> {
  const attempt = (prev?.attempt ?? 0) + 1;
  const raw = leadInputFromForm(formData);
  const values = {
    name: String(raw.name ?? "").slice(0, 200),
    email: String(raw.email ?? "").slice(0, 254),
    phone: String(raw.phone ?? "").slice(0, 40),
    itemsDescription: String(raw.itemsDescription ?? "").slice(0, 5000),
    message: String(raw.message ?? "").slice(0, 5000),
    consent: raw.consent === true,
  };

  // Honeypot: humans never fill it. Pretend success, store nothing.
  const hp = formData.get("website");
  if (typeof hp === "string" && hp !== "") return { ok: true, attempt };

  try {
    const tenant = await getRequestTenant();
    if (!tenant) return { ok: false, error: t.unexpected, values, attempt };
    const res = await submitLead({
      tenantId: tenant.id,
      draftToken: formData.get("draft"),
      data: raw,
      ip: await clientIp(),
      turnstileToken: turnstileTokenFrom(formData),
    });
    if (res.ok) return { ok: true, attempt };
    return { ok: false, error: t[res.error], fieldErrors: res.fieldErrors, values, attempt };
  } catch (error) {
    console.error("submitLeadAction failed", error);
    return { ok: false, error: t.unexpected, values, attempt };
  }
}
