"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRequestTenant } from "@/server/tenant";
import { clientIp } from "@/server/customer-auth/current";
import { hit, isLimited } from "@/server/auth/rate-limit";
import { retryOrderPayment, simulateDevPayment, startOrderPayment, isDevSimulationAllowed } from "@/server/checkout";
import { DEV_OUTCOMES, type DevOutcome } from "@/server/checkout/payment";
import { orderStatusPath } from "@/server/checkout/urls";

/*
 * Order page actions (POST only — the page itself never changes anything).
 *  - payOrderAction: "Pay now" / "Try again" → re-reserve (all or nothing) → new or reused Mollie payment.
 *  - simulatePaymentAction: DEVELOPMENT ONLY, no Mollie key: runs the webhook's status logic.
 * The uuid (random, unguessable) is the only reference the customer has.
 */

export type PayOrderState = { message: string } | null;

const RETRY_RULE = { limit: 20, windowMs: 15 * 60 * 1000 };
const uuidSchema = z.uuid();

async function tenantId(): Promise<string> {
  const tenant = await getRequestTenant();
  if (!tenant) throw new Error("No shop on this host");
  return tenant.id;
}

export async function payOrderAction(_prev: PayOrderState, form: FormData): Promise<PayOrderState> {
  const uuid = form.get("uuid");
  if (typeof uuid !== "string" || !uuidSchema.safeParse(uuid).success) return { message: "Order not found" };
  const tid = await tenantId();
  const key = `order.retry:${tid}:${(await clientIp()) ?? "unknown"}`;
  if (await isLimited(key, RETRY_RULE)) return { message: "Too many attempts. Please wait a few minutes and try again." };
  await hit(key);

  const retry = await retryOrderPayment(tid, uuid);
  if (!retry.ok) {
    revalidatePath(orderStatusPath(uuid));
    return { message: retry.message };
  }
  const start = await startOrderPayment(tid, retry.orderId, { host: (await headers()).get("host") ?? "" });
  if (start.kind === "redirect") redirect(start.url);
  revalidatePath(orderStatusPath(uuid));
  if (start.kind === "error") return { message: start.message };
  return null;
}

export async function simulatePaymentAction(form: FormData): Promise<void> {
  if (!isDevSimulationAllowed()) throw new Error("Not available");
  const uuid = form.get("uuid");
  const outcome = form.get("outcome");
  if (typeof uuid !== "string" || typeof outcome !== "string" || !(DEV_OUTCOMES as readonly string[]).includes(outcome)) return;
  await simulateDevPayment(await tenantId(), uuid, outcome as DevOutcome);
  revalidatePath(orderStatusPath(uuid));
}
