import "server-only";
import { enqueue, type EnqueueOptions } from "@/server/jobs/queue";

/*
 * Entry points for other modules (catalog, stock, orders). Each only ENQUEUES a job, so callers stay
 * fast and an alert problem can never break a product save or a checkout. Errors are logged, not
 * thrown. Prefer calling them AFTER the caller's transaction commits; passing `{ tx }` makes the job
 * part of that transaction instead.
 *
 * The `alerts.scan` cron catches anything a missing hook would miss (published products and released
 * reservations of the last minutes), so the hooks only make alerts faster — not correct.
 */

type HookOpts = Pick<EnqueueOptions, "tx">;

async function safeEnqueue(fn: () => Promise<unknown>, what: string) {
  try {
    await fn();
  } catch (err) {
    console.error(`[alerts] ${what} failed`, err);
  }
}

/** A product became ACTIVE/published or was bumped (publishedAt set or moved forward). */
export async function onProductPublished(tenantId: string, productId: string, opts: HookOpts = {}): Promise<void> {
  await safeEnqueue(() => enqueue("alerts.match-product", { tenantId, productId }, opts), "onProductPublished");
}

/** Several products at once (bulk status change / bump). */
export async function onProductsPublished(tenantId: string, productIds: string[], opts: HookOpts = {}): Promise<void> {
  for (const productId of productIds) await onProductPublished(tenantId, productId, opts);
}

/**
 * A reservation of a product was released or expired. `excludeCustomerId`: the customer whose own
 * cart released it (they don't need a "back available" mail).
 */
export async function onReservationReleased(
  tenantId: string,
  productId: string,
  opts: HookOpts & { excludeCustomerId?: string | null } = {},
): Promise<void> {
  const { excludeCustomerId, ...rest } = opts;
  await safeEnqueue(
    // Small delay: the product page / cart settle first, and a quick re-add by the same visitor wins.
    () => enqueue("alerts.back-available", { tenantId, productId, excludeCustomerId: excludeCustomerId ?? null }, { ...rest, startAfter: 60 }),
    "onReservationReleased",
  );
}

/** The price of a product changed (minor units). Only decreases trigger alerts. */
export async function onPriceChanged(tenantId: string, productId: string, oldPrice: number, newPrice: number, opts: HookOpts = {}): Promise<void> {
  if (!(newPrice < oldPrice) || newPrice <= 0) return;
  await safeEnqueue(() => enqueue("alerts.price-drop", { tenantId, productId, oldPrice, newPrice }, opts), "onPriceChanged");
}
