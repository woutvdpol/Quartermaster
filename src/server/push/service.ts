import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError } from "@/server/context";
import { enqueue } from "@/server/jobs/queue";
import type { Prisma } from "@/generated/prisma/client";
import { productHref } from "@/server/storefront-catalog/urls";
import { isPushConfigured } from "./config";
import { pushCopy } from "./copy";
import { MAX_PER_DAY_OPTIONS, dedupeKeys, hasQuietHours, safePushUrl, type PushKind } from "./rules";

/*
 * Web push for logged-in shop customers (docs/push.md): subscriptions (one row per browser/device),
 * preferences, and queueing a PushMessage. Sending is the `push.send` job (./send.ts, worker only).
 * Every query is scoped by tenant + customer from the session — never from the client.
 */

export type PushOwner = { tenantId: string; customerId: string };

// ─── Subscriptions ─────────────────────────────────────────────────────────

const subscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({ p256dh: z.string().min(16).max(256), auth: z.string().min(8).max(128) }),
});
export type PushSubscriptionInput = z.input<typeof subscriptionSchema>;

/**
 * Stores the browser's subscription for this customer. The endpoint is unique: the same device
 * subscribing again (or after another customer used it) simply moves the row to this login.
 */
export async function savePushSubscription(owner: PushOwner, input: unknown, opts: { userAgent?: string | null } = {}): Promise<{ id: string }> {
  if (!isPushConfigured()) throw new ServiceError("UNAVAILABLE", "Push alerts are not available");
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError("INVALID", "Invalid push subscription", parsed.error.issues);
  const { endpoint, keys } = parsed.data;
  const customer = await db.customer.findFirst({ where: { id: owner.customerId, tenantId: owner.tenantId }, select: { id: true } });
  if (!customer) throw new ServiceError("NOT_FOUND", "Customer not found");
  const data = {
    tenantId: owner.tenantId,
    customerId: owner.customerId,
    p256dh: keys.p256dh,
    auth: keys.auth,
    userAgent: opts.userAgent?.slice(0, 300) ?? null,
    failedAt: null,
  };
  const row = await db.pushSubscription.upsert({ where: { endpoint }, create: { endpoint, ...data }, update: data, select: { id: true } });
  await audit({ action: "push.subscribed", tenantId: owner.tenantId, entity: "Customer", entityId: owner.customerId });
  return row;
}

/** "Turn off push on this device" (endpoint given) or on every device of the customer (endpoint null). */
export async function removePushSubscription(owner: PushOwner, endpoint: string | null): Promise<number> {
  const res = await db.pushSubscription.deleteMany({
    where: { tenantId: owner.tenantId, customerId: owner.customerId, ...(endpoint ? { endpoint: endpoint.slice(0, 2048) } : {}) },
  });
  if (res.count) await audit({ action: "push.unsubscribed", tenantId: owner.tenantId, entity: "Customer", entityId: owner.customerId, data: { count: res.count } });
  return res.count;
}

// ─── Preferences ───────────────────────────────────────────────────────────

export type PushPrefs = {
  /** Push configured on the platform (VAPID keys). */
  available: boolean;
  devices: number;
  /** Is this endpoint (the current browser) one of the customer's devices? */
  thisDevice: boolean;
  quietStart: number | null;
  quietEnd: number | null;
  maxPerDay: number;
  wishlist: boolean;
  reservation: boolean;
};

export async function getPushPrefs(owner: PushOwner, endpoint?: string | null): Promise<PushPrefs> {
  const c = await db.customer.findFirst({
    where: { id: owner.customerId, tenantId: owner.tenantId },
    select: {
      pushQuietStart: true,
      pushQuietEnd: true,
      pushMaxPerDay: true,
      pushWishlist: true,
      pushReservation: true,
      pushSubscriptions: { where: { failedAt: null }, select: { endpoint: true } },
    },
  });
  if (!c) throw new ServiceError("NOT_FOUND", "Customer not found");
  return {
    available: isPushConfigured(),
    devices: c.pushSubscriptions.length,
    thisDevice: !!endpoint && c.pushSubscriptions.some((s) => s.endpoint === endpoint),
    quietStart: hasQuietHours(c.pushQuietStart, c.pushQuietEnd) ? c.pushQuietStart : null,
    quietEnd: hasQuietHours(c.pushQuietStart, c.pushQuietEnd) ? c.pushQuietEnd : null,
    maxPerDay: c.pushMaxPerDay,
    wishlist: c.pushWishlist,
    reservation: c.pushReservation,
  };
}

const minuteSchema = z.number().int().min(0).max(24 * 60 - 1);
const prefsSchema = z
  .object({
    quietStart: minuteSchema.nullable(),
    quietEnd: minuteSchema.nullable(),
    maxPerDay: z.number().int().refine((n) => (MAX_PER_DAY_OPTIONS as readonly number[]).includes(n), "Invalid maximum"),
    wishlist: z.boolean(),
    reservation: z.boolean(),
  })
  .partial();
export type PushPrefsPatch = z.input<typeof prefsSchema>;

export async function updatePushPrefs(owner: PushOwner, patch: unknown): Promise<void> {
  const parsed = prefsSchema.safeParse(patch);
  if (!parsed.success) throw new ServiceError("INVALID", parsed.error.issues[0]?.message ?? "Invalid input", parsed.error.issues);
  const p = parsed.data;
  const data: Prisma.CustomerUpdateManyMutationInput = {};
  if (p.quietStart !== undefined || p.quietEnd !== undefined) {
    const on = hasQuietHours(p.quietStart, p.quietEnd);
    data.pushQuietStart = on ? p.quietStart! : null;
    data.pushQuietEnd = on ? p.quietEnd! : null;
  }
  if (p.maxPerDay !== undefined) data.pushMaxPerDay = p.maxPerDay;
  if (p.wishlist !== undefined) data.pushWishlist = p.wishlist;
  if (p.reservation !== undefined) data.pushReservation = p.reservation;
  const res = await db.customer.updateMany({ where: { id: owner.customerId, tenantId: owner.tenantId }, data });
  if (!res.count) throw new ServiceError("NOT_FOUND", "Customer not found");
}

// ─── Queueing ──────────────────────────────────────────────────────────────

/**
 * Customers (of `customerIds`) that can receive a push now: push configured, at least one device,
 * and — for wishlist / reservation alerts — the matching preference on. Empty when push is off.
 */
export async function pushRecipients(
  tenantId: string,
  customerIds: string[],
  pref?: "pushWishlist" | "pushReservation",
  client: Prisma.TransactionClient = db,
): Promise<Set<string>> {
  const ids = [...new Set(customerIds)].filter(Boolean);
  if (!ids.length || !isPushConfigured()) return new Set();
  const rows = await client.customer.findMany({
    where: { tenantId, id: { in: ids }, ...(pref ? { [pref]: true } : {}), pushSubscriptions: { some: { failedAt: null } } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

export type QueuePushInput = {
  tenantId: string;
  customerId: string;
  kind: PushKind;
  title: string;
  body: string;
  url: string;
  dedupeKey: string;
};

/**
 * Creates the PushMessage (once per customer + dedupeKey) and queues `push.send`. Pass `tx` to make
 * both part of the caller's transaction. Returns false for a duplicate event.
 */
export async function queuePush(input: QueuePushInput, opts: { tx?: Prisma.TransactionClient } = {}): Promise<boolean> {
  const client = opts.tx ?? db;
  const created = await client.pushMessage.createManyAndReturn({
    data: [
      {
        tenantId: input.tenantId,
        customerId: input.customerId,
        kind: input.kind,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 500),
        url: safePushUrl(input.url),
        dedupeKey: input.dedupeKey,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  if (!created.length) return false;
  await enqueue("push.send", { messageId: created[0].id }, { tx: opts.tx, singletonKey: created[0].id });
  return true;
}

/** Errors never reach the alert pipelines: a push problem must not break or retry an e-mail alert. */
async function safely(what: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[push] ${what} failed`, err);
  }
}

/** Saved-search INSTANT push for one new delivery (called inside the matching transaction). */
export async function queueSavedSearchPush(
  tx: Prisma.TransactionClient,
  p: {
    tenantId: string;
    customerId: string;
    deliveryId: string;
    searchName: string;
    product: { title: string; price: number; stockCode: number; slug: string };
    currency: string;
  },
): Promise<boolean> {
  const text = pushCopy.newMatch({ title: p.product.title, price: p.product.price, currency: p.currency, searchName: p.searchName });
  return queuePush(
    { tenantId: p.tenantId, customerId: p.customerId, kind: "SAVED_SEARCH", ...text, url: productHref(p.product), dedupeKey: dedupeKeys.savedSearch(p.deliveryId) },
    { tx },
  );
}

/** Wishlist price drop: push to the customers whose e-mail alert was just claimed (and who opted in). */
export async function queuePriceDropPushes(tenantId: string, productId: string, oldPrice: number, newPrice: number, customerIds: string[]): Promise<number> {
  let queued = 0;
  await safely("price-drop push", async () => {
    const to = await pushRecipients(tenantId, customerIds, "pushWishlist");
    if (!to.size) return;
    const p = await db.product.findFirst({
      where: { id: productId, tenantId },
      select: { title: true, stockCode: true, slug: true, tenant: { select: { currency: true } } },
    });
    if (!p) return;
    const text = pushCopy.priceDrop({ title: p.title, oldPrice, newPrice, currency: p.tenant.currency });
    for (const customerId of to) {
      const ok = await queuePush({
        tenantId,
        customerId,
        kind: "PRICE_DROP",
        ...text,
        url: productHref(p),
        dedupeKey: dedupeKeys.priceDrop(productId, newPrice),
      });
      if (ok) queued++;
    }
  });
  return queued;
}

