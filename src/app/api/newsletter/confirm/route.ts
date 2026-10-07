import { MAIL_PATHS } from "@/server/mail/urls";

/**
 * Legacy double opt-in link target (mails sent before the confirm page existed).
 * `GET /api/newsletter/confirm?token=…` changes NOTHING — mail scanners and link previews fetch GET
 * links — it only forwards to the storefront page `/newsletter/confirm?token=…`, where the visitor
 * confirms with a button (POST → server action → confirmSubscription).
 */
export function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const query = token ? `?${new URLSearchParams({ token: token.slice(0, 200) })}` : "";
  // Relative Location: resolved by the browser against the shop host it requested (request.url may
  // carry an internal host behind a proxy / in dev).
  return new Response(null, {
    status: 303,
    headers: { Location: `${MAIL_PATHS.newsletterConfirm}${query}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
