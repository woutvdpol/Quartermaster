import { db } from "@/server/db";
import { handleMollieWebhook } from "@/server/payments/mollie";

/**
 * Mollie webhook: POST /api/webhooks/mollie/<tenant-id> (id, not slug: renaming a shop must not break open payments) with form body `id=tr_…`.
 *
 * - The body is only used for the payment id; the status is always re-fetched from Mollie.
 * - Unknown tenant / unknown or malformed id → 200 (Mollie stops retrying; nothing leaks).
 * - Transient failures (Mollie or DB unreachable, payment row not committed yet) → 500 so Mollie retries.
 * - Tenants that are SUSPENDED/ARCHIVED still get their payments recorded (money already moved).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/mollie/[tenant]">) {
  const headers = { "Cache-Control": "no-store", "Content-Type": "text/plain" };
  const ok = () => new Response("ok", { status: 200, headers });

  const { tenant: tenantId } = await ctx.params;
  let id: string | null = null;
  try {
    const form = await request.formData();
    const value = form.get("id");
    id = typeof value === "string" ? value : null;
  } catch {
    return ok();
  }
  if (!id || !tenantId || tenantId.length > 100) return ok();

  try {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) return ok();
    const outcome = await handleMollieWebhook(tenant.id, id);
    if (outcome.outcome === "ignored") console.info(`[mollie-webhook] ${tenantId}: ignored ${outcome.reason}`);
    return ok();
  } catch (err) {
    console.error(`[mollie-webhook] ${tenantId}: retryable failure`, err instanceof Error ? err.message : err);
    return new Response("retry", { status: 500, headers });
  }
}
