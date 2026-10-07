import "server-only";
import { db } from "@/server/db";

/**
 * Absolute URLs for links in mails. Mails are rendered in the worker (no request), so the host comes
 * from the tenant's primary TenantDomain, falling back to APP_URL. The scheme follows APP_URL when
 * set, otherwise http for local hosts (localhost, *.localhost, *.test, explicit port) and https elsewhere.
 */

// Paths owned by other parts of the app — keep in sync with the routes that serve them.
export const MAIL_PATHS = {
  adminPasswordReset: "/admin/reset-password",
  customerPasswordReset: "/account/reset-password",
  orderStatus: (uuid: string) => `/order/${uuid}`,
  adminOrder: (orderId: string) => `/admin/orders/${orderId}`,
  newsletterConfirm: "/api/newsletter/confirm",
  newsletterUnsubscribe: "/api/newsletter/unsubscribe",
  /** Storefront page that shows the outcome (`?status=confirmed|invalid|expired|unsubscribed`). */
  newsletterStatusPage: "/newsletter",
} as const;

function isLocalHost(host: string): boolean {
  const name = host.replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name.endsWith(".localhost") || name.endsWith(".test") || /:\d+$/.test(host);
}

export function hostToBaseUrl(host: string): string {
  const appUrl = process.env.APP_URL;
  const scheme = appUrl ? new URL(appUrl).protocol.replace(":", "") : isLocalHost(host) ? "http" : "https";
  return `${scheme}://${host}`;
}

/** Base URL of the platform (superadmin) host. */
export function platformBaseUrl(): string {
  const appUrl = process.env.APP_URL;
  if (appUrl) return appUrl.replace(/\/+$/, "");
  const host = process.env.PLATFORM_HOST;
  if (host) return hostToBaseUrl(host);
  return "http://localhost:3000";
}

/** Base URL of a tenant's shop (primary domain → any domain → platform). No trailing slash. */
export async function tenantBaseUrl(tenantId: string | null): Promise<string> {
  if (!tenantId) return platformBaseUrl();
  const domain = await db.tenantDomain.findFirst({
    where: { tenantId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { host: true },
  });
  return domain ? hostToBaseUrl(domain.host) : platformBaseUrl();
}

export function withQuery(base: string, path: string, query: Record<string, string>): string {
  const url = new URL(path, base + "/");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}
