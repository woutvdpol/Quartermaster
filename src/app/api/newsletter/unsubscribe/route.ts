import { connection } from "next/server";
import { db } from "@/server/db";
import { getRequestTenant } from "@/server/tenant";
import { unsubscribeSigned, verifyUnsubscribe } from "@/server/newsletter";
import { escapeHtml } from "@/server/newsletter/markdown";

/*
 * Unsubscribe link from newsletter mails: /api/newsletter/unsubscribe?t=<tenant>&s=<subscriber>&sig=<hmac>
 *
 *  GET  → small confirmation page with an "Unsubscribe" button (GET never changes state, so link
 *         scanners / prefetchers can't unsubscribe people).
 *  POST → unsubscribes. This is also the RFC 8058 one-click endpoint (`List-Unsubscribe-Post:
 *         List-Unsubscribe=One-Click`): mailbox providers POST here without cookies or login; the
 *         HMAC signature in the URL is the authorization.
 */

type Params = { tenantId: string; subscriberId: string; sig: string };

function readParams(request: Request): Params {
  const q = new URL(request.url).searchParams;
  return { tenantId: q.get("t") ?? "", subscriberId: q.get("s") ?? "", sig: q.get("sig") ?? "" };
}

async function hostAllows(p: Params): Promise<boolean> {
  // On a shop's own domain, only that shop's links are valid.
  const tenant = await getRequestTenant().catch(() => null);
  return !tenant || tenant.id === p.tenantId;
}

async function shopName(tenantId: string): Promise<string> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }).catch(() => null);
  return tenant?.name ?? "this shop";
}

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f4f4f2;color:#222;margin:0;padding:48px 16px}
main{max-width:440px;margin:0 auto;background:#fff;padding:28px 32px;border-radius:6px}h1{font-size:20px;margin:0 0 12px}p{line-height:1.5}
button{background:#8b1e1e;color:#fff;border:0;border-radius:4px;padding:10px 18px;font-size:15px;cursor:pointer}</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}

const invalidPage = () =>
  page(400, "Invalid link", "<p>This unsubscribe link is invalid or incomplete. Please use the link from the most recent email.</p>");

export async function GET(request: Request) {
  await connection();
  const p = readParams(request);
  if (!(await hostAllows(p)) || !verifyUnsubscribe(p.tenantId, p.subscriberId, p.sig)) return invalidPage();
  const name = escapeHtml(await shopName(p.tenantId));
  const action = escapeHtml(new URL(request.url).pathname + new URL(request.url).search);
  return page(
    200,
    "Unsubscribe",
    `<p>Do you want to stop receiving the ${name} newsletter?</p>
<form method="post" action="${action}"><input type="hidden" name="via" value="page"><button type="submit">Unsubscribe</button></form>`,
  );
}

export async function POST(request: Request) {
  await connection();
  const p = readParams(request);
  const form = await request.formData().catch(() => null);
  const fromPage = form?.get("via") === "page";
  if (!(await hostAllows(p))) return fromPage ? invalidPage() : new Response("Invalid link", { status: 400 });

  const result = await unsubscribeSigned(p);
  if (!result.ok) return fromPage ? invalidPage() : new Response("Invalid link", { status: 400 });
  if (fromPage) {
    const name = escapeHtml(await shopName(p.tenantId));
    return page(200, "You are unsubscribed", `<p>You will no longer receive the ${name} newsletter.</p>`);
  }
  // One-click (RFC 8058): any 2xx is success.
  return new Response("Unsubscribed", { status: 200, headers: { "Cache-Control": "no-store" } });
}
