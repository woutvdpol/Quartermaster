import { connection } from "next/server";
import { getRequestTenant } from "@/server/tenant";
import { confirmSubscription } from "@/server/newsletter";
import { MAIL_PATHS } from "@/server/mail/urls";

/**
 * Double opt-in link target: `GET /api/newsletter/confirm?token=…` confirms and redirects to the
 * storefront status page `/newsletter?status=confirmed|expired|invalid`.
 */
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const tenant = await getRequestTenant().catch(() => null);
  const result = await confirmSubscription(token, { tenantId: tenant?.id ?? null });
  const status = result.ok ? "confirmed" : result.error;
  const target = new URL(MAIL_PATHS.newsletterStatusPage, url);
  target.searchParams.set("status", status);
  return new Response(null, {
    status: 303,
    headers: { Location: target.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
