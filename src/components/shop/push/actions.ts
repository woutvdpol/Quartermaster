"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { ServiceError } from "@/server/context";
import { getShopCustomer } from "@/server/customer-auth";
import { updateCustomerSearch } from "@/server/alerts";
import { getPushPrefs, removePushSubscription, savePushSubscription, updatePushPrefs, vapidPublicKey, type PushPrefs } from "@/server/push";

/*
 * Server actions for web push (docs/push.md). Logged-in customers only; tenant from the request host
 * and customer from the session — never from the client.
 */

export type PushState = { loggedIn: false } | ({ loggedIn: true; publicKey: string | null } & PushPrefs);
export type PushActionResult = { ok: boolean; message?: string };

async function owner() {
  const c = await getShopCustomer();
  return c ? { tenantId: c.tenant.id, customerId: c.customer.id } : null;
}

const endpointSchema = z.string().max(2048).nullish();

/** Push availability + preferences; `endpoint` = this browser's subscription (is it registered?). */
export async function getPushStateAction(endpoint?: string | null): Promise<PushState> {
  const o = await owner();
  if (!o) return { loggedIn: false };
  const prefs = await getPushPrefs(o, endpointSchema.catch(null).parse(endpoint));
  return { loggedIn: true, publicKey: prefs.available ? vapidPublicKey() : null, ...prefs };
}

function fail(err: unknown, what: string): PushActionResult {
  if (err instanceof ServiceError) return { ok: false, message: err.message };
  console.error(`${what} failed`, err);
  return { ok: false, message: "Something went wrong. Please try again." };
}

/**
 * Stores this browser's subscription. With `searchId`, also switches that saved search to push
 * (INSTANT, no instant e-mail) — the "Push alert on this phone" choice after saving a search.
 */
export async function subscribePushAction(subscription: unknown, opts: { searchId?: string | null } = {}): Promise<PushActionResult> {
  const o = await owner();
  if (!o) return { ok: false, message: "Please log in again." };
  try {
    const ua = (await headers()).get("user-agent");
    await savePushSubscription(o, subscription, { userAgent: ua });
    const searchId = z.string().min(1).max(64).nullish().catch(null).parse(opts.searchId);
    if (searchId) await updateCustomerSearch(o, searchId, { push: true, frequency: "INSTANT" });
    revalidatePath("/account/alerts");
    return { ok: true };
  } catch (err) {
    return fail(err, "subscribePushAction");
  }
}

/** "E-mail" chosen after saving a search: push off for that search (frequency stays as saved). */
export async function keepEmailAction(searchId: string): Promise<PushActionResult> {
  const o = await owner();
  if (!o) return { ok: false, message: "Please log in again." };
  try {
    await updateCustomerSearch(o, z.string().min(1).max(64).parse(searchId), { push: false });
    return { ok: true };
  } catch (err) {
    return fail(err, "keepEmailAction");
  }
}

/** "Turn off push on this device" (endpoint) — or every device (`all`). */
export async function unsubscribePushAction(endpoint: string | null, opts: { all?: boolean } = {}): Promise<PushActionResult> {
  const o = await owner();
  if (!o) return { ok: false, message: "Please log in again." };
  const ep = endpointSchema.catch(null).parse(endpoint);
  if (!ep && !opts.all) return { ok: true };
  try {
    await removePushSubscription(o, opts.all ? null : ep!);
    revalidatePath("/account/alerts");
    return { ok: true };
  } catch (err) {
    return fail(err, "unsubscribePushAction");
  }
}

export async function updatePushPrefsAction(patch: unknown): Promise<PushActionResult> {
  const o = await owner();
  if (!o) return { ok: false, message: "Please log in again." };
  try {
    await updatePushPrefs(o, patch);
    revalidatePath("/account/alerts");
    return { ok: true, message: "Saved." };
  } catch (err) {
    return fail(err, "updatePushPrefsAction");
  }
}
