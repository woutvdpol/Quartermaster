import { connection } from "next/server";
import { getRequestTenant } from "@/server/tenant";
import { performUnsubscribe, readUnsubscribeTarget } from "../../_links";

/*
 * RFC 8058 one-click unsubscribe for alert mails (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`).
 * Mailbox providers POST here without cookies; the HMAC in the URL is the authorization.
 * GET (a person following the header link) is sent to the confirmation page instead.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  return Response.redirect(new URL(`/alerts/unsubscribe${url.search}`, url), 303);
}

export async function POST(request: Request) {
  await connection();
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const tenant = await getRequestTenant().catch(() => null);
  const ok = await performUnsubscribe(readUnsubscribeTarget(q), tenant?.id ?? null);
  return new Response(ok ? "Unsubscribed" : "Invalid link", { status: ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}
