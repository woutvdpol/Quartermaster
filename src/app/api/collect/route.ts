import { handleCollect } from "@/server/analytics/record";

/**
 * Cookieless page-view beacon for the storefront: POST {"path": "/shop/x?utm_source=y", "referrer": document.referrer}.
 * Accepts JSON or text/plain (navigator.sendBeacon). The tenant is resolved from the request host;
 * see src/server/analytics/record.ts for filtering and privacy rules.
 */
export async function POST(request: Request) {
  try {
    const { response } = await handleCollect(request);
    return response;
  } catch (err) {
    // Analytics must never surface errors to visitors.
    console.error("[collect] failed to record page view:", err);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
}
