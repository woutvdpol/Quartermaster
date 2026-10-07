import "server-only";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import type { MailBrand } from "@/emails/types";
import { platformBaseUrl, tenantBaseUrl } from "./urls";

/** Who a tenant's mail comes from, plus the branding the templates render. */
export type MailIdentity = {
  brand: MailBrand;
  /** RFC 5322 From header, e.g. `"Concept Militaria" <no-reply@quartermaster.app>`. */
  from: string;
  replyTo: string | null;
  /** Where order notifications go (mail.orderNotificationEmail → general.contactEmail), or null. */
  ownerEmail: string | null;
  confirmationMessage: string;
  timeZone: string;
};

const PLATFORM_COLORS = { primary: "#3f4a2c", secondary: "#c2b280", accent: "#8b1e1e" };

/** The From address. One verified sending address for every tenant (SPF/DKIM); the name is per tenant. */
export function fallbackFromAddress(): string {
  return process.env.MAIL_FROM_FALLBACK?.trim() || "no-reply@quartermaster.localhost";
}

export function formatAddress(name: string, email: string): string {
  // Quote the display name; strip characters that could break the header.
  const clean = name.replace(/["\\\r\n<>]/g, "").trim();
  return clean ? `"${clean}" <${email}>` : email;
}

export async function loadMailIdentity(tenantId: string | null): Promise<MailIdentity> {
  if (!tenantId) {
    const baseUrl = platformBaseUrl();
    return {
      brand: { name: "Quartermaster", baseUrl, logoUrl: null, colors: PLATFORM_COLORS, contactEmail: null, address: "" },
      from: formatAddress("Quartermaster", fallbackFromAddress()),
      replyTo: null,
      ownerEmail: null,
      confirmationMessage: "",
      timeZone: "Europe/Amsterdam",
    };
  }
  const [tenant, general, appearance, mail, baseUrl] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, timezone: true } }),
    getSettings(tenantId, "general"),
    getSettings(tenantId, "appearance"),
    getSettings(tenantId, "mail"),
    tenantBaseUrl(tenantId),
  ]);
  const name = mail.fromName || general.shopName || tenant.name;
  const contactEmail = general.contactEmail || null;
  const a = general.address;
  const address = [a.line1, [a.postalCode, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ");
  return {
    brand: {
      name,
      baseUrl,
      logoUrl: appearance.logoPath ? `${baseUrl}${appearance.logoPath}` : null,
      colors: appearance.colors,
      contactEmail,
      address: a.line1 || a.city ? address : "",
    },
    from: formatAddress(name, fallbackFromAddress()),
    replyTo: mail.replyTo || contactEmail,
    ownerEmail: mail.orderNotificationEmail || contactEmail,
    confirmationMessage: mail.confirmationMessage,
    timeZone: tenant.timezone,
  };
}
