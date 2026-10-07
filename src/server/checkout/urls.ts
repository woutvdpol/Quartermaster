import "server-only";
import { hostToBaseUrl } from "@/server/mail/urls";

/*
 * URLs handed to Mollie.
 *  - redirectUrl: the shop's own host (the one the customer is on) → /order/<uuid>. Only shows status.
 *  - webhookUrl: must be reachable from the internet. Base = MOLLIE_WEBHOOK_BASE_URL (e.g. an ngrok
 *    tunnel in development) → APP_URL → the shop host. The route identifies the tenant by id in the
 *    path, so any host that reaches this app works.
 */

export function shopBaseUrl(host: string): string {
  return hostToBaseUrl(host).replace(/\/+$/, "");
}

export function orderStatusPath(uuid: string): string {
  return `/order/${uuid}`;
}

export function webhookBaseUrl(shopBase: string): string {
  const explicit = process.env.MOLLIE_WEBHOOK_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const app = process.env.APP_URL?.trim();
  if (app) return app.replace(/\/+$/, "");
  return shopBase;
}

export function mollieWebhookUrl(tenantId: string, shopBase: string): string {
  return `${webhookBaseUrl(shopBase)}/api/webhooks/mollie/${encodeURIComponent(tenantId)}`;
}

/** True when Mollie can't reach this base (localhost etc.) — webhooks won't arrive; use a tunnel. */
export function isLocalBase(base: string): boolean {
  try {
    const h = new URL(base).hostname;
    return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".test") || h === "127.0.0.1" || h === "[::1]";
  } catch {
    return true;
  }
}
