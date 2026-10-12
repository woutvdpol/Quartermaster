import "server-only";
import webpush, { WebPushError } from "web-push";
import { db } from "@/server/db";
import { enqueue } from "@/server/jobs/queue";
import { hasModule, tenantsWithModule } from "@/server/modules";
import { vapidConfig } from "./config";
import {
  ACTIVE_BIDDER_MS,
  STALE_AFTER_MS,
  UNCAPPED_KINDS,
  auctionLotIdFromDedupeKey,
  buildPushPayload,
  decidePush,
  isLiveAuctionKind,
  pushModuleFor,
  pushTtlSeconds,
  startOfLocalDay,
  type PushKind,
} from "./rules";

/*
 * Delivery of PushMessage rows (worker only; docs/push.md). `push.send` → sendPushMessage():
 *   1. no devices left / push not configured → the message is deleted (nothing to deliver)
 *   2. quiet hours / daily cap → PushMessage.queuedFor is set; the `push.flush` cron re-queues it
 *      when due (RESERVATION_ENDING in quiet hours is deleted instead)
 *   3. claim (sentAt) → web-push to every device; 404/410 = the subscription is gone → row deleted.
 *      Nothing delivered and only transient errors → unclaim and throw (pg-boss retries).
 * A message whose module (pushModuleFor: `auctions` for AUCTION_*, else `alerts`; docs/modules.md) the
 * shop lacks is dropped ("disabled") and the flush cron skips it; subscriptions are kept.
 */

/** Pushes per message shown as the notification icon (generated from the shop logo, src/app/pwa-icon). */
export const PUSH_ICON_PATH = "/pwa-icon/192";

export type SendResult =
  | { status: "sent"; delivered: number; removed: number }
  | { status: "deferred"; until: Date; reason: "quiet" | "cap" }
  | { status: "dropped"; reason: "quiet" | "no-devices" | "disabled" | "stale" }
  | { status: "skipped" };

const GONE = new Set([404, 410]);
const AUCTION_KINDS = ["AUCTION_OUTBID", "AUCTION_ENDING", "AUCTION_WON"] as const satisfies readonly PushKind[];

export async function sendPushMessage(messageId: string, now = new Date()): Promise<SendResult> {
  const msg = await db.pushMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      tenantId: true,
      customerId: true,
      kind: true,
      title: true,
      body: true,
      url: true,
      dedupeKey: true,
      queuedFor: true,
      sentAt: true,
      createdAt: true,
      tenant: { select: { timezone: true, status: true } },
      customer: { select: { pushQuietStart: true, pushQuietEnd: true, pushMaxPerDay: true } },
    },
  });
  if (!msg || msg.sentAt) return { status: "skipped" };
  if (msg.queuedFor && msg.queuedFor.getTime() > now.getTime()) return { status: "skipped" }; // flush re-queues it

  const drop = async (reason: "quiet" | "no-devices" | "disabled" | "stale") => {
    await db.pushMessage.deleteMany({ where: { id: msg.id, sentAt: null } });
    return { status: "dropped" as const, reason };
  };
  const vapid = vapidConfig();
  if (!vapid || msg.tenant.status !== "ACTIVE") return drop("disabled");
  if (!(await hasModule(msg.tenantId, pushModuleFor(msg.kind)))) return drop("disabled");
  if (now.getTime() - msg.createdAt.getTime() > STALE_AFTER_MS) return drop("stale");

  const subs = await db.pushSubscription.findMany({
    where: { tenantId: msg.tenantId, customerId: msg.customerId, failedAt: null },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (!subs.length) return drop("no-devices");

  const timeZone = msg.tenant.timezone;
  // Live auction pushes (docs/auctions.md): pointless once the lot closed; TTL runs until the close.
  let lotClosesAt: Date | null = null;
  let activelyBidding = false;
  if (isLiveAuctionKind(msg.kind)) {
    const lotId = auctionLotIdFromDedupeKey(msg.dedupeKey);
    const lot = lotId ? await db.auctionLot.findFirst({ where: { id: lotId, tenantId: msg.tenantId }, select: { status: true, closesAt: true } }) : null;
    if (!lot || lot.status !== "OPEN" || lot.closesAt.getTime() <= now.getTime()) return drop("stale");
    lotClosesAt = lot.closesAt;
    const recent = await db.bid.findFirst({
      where: { tenantId: msg.tenantId, customerId: msg.customerId, createdAt: { gte: new Date(now.getTime() - ACTIVE_BIDDER_MS) } },
      select: { id: true },
    });
    activelyBidding = !!recent;
  }
  const sentToday = UNCAPPED_KINDS.includes(msg.kind)
    ? 0
    : await db.pushMessage.count({
        where: { customerId: msg.customerId, kind: { notIn: [...UNCAPPED_KINDS] }, sentAt: { gte: startOfLocalDay(now, timeZone) } },
      });
  const decision = decidePush({
    activelyBidding,
    kind: msg.kind,
    now,
    timeZone,
    quietStart: msg.customer.pushQuietStart,
    quietEnd: msg.customer.pushQuietEnd,
    sentToday,
    maxPerDay: msg.customer.pushMaxPerDay,
  });
  if (decision.action === "drop") return drop(decision.reason);
  if (decision.action === "defer") {
    await db.pushMessage.updateMany({ where: { id: msg.id, sentAt: null }, data: { queuedFor: decision.until } });
    return { status: "deferred", until: decision.until, reason: decision.reason };
  }

  const claimed = await db.pushMessage.updateMany({ where: { id: msg.id, sentAt: null }, data: { sentAt: now, queuedFor: null } });
  if (!claimed.count) return { status: "skipped" };

  const payload = buildPushPayload(msg, { icon: PUSH_ICON_PATH });
  const options: webpush.RequestOptions = {
    TTL: pushTtlSeconds(msg.kind, now, lotClosesAt),
    urgency: msg.kind === "RESERVATION_ENDING" || isLiveAuctionKind(msg.kind) ? "high" : "normal",
    vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    timeout: 10_000,
  };
  const results = await Promise.allSettled(
    subs.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options)),
  );

  let delivered = 0;
  const gone: string[] = [];
  const ok: string[] = [];
  let transient: unknown = null;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      delivered++;
      ok.push(subs[i].id);
    } else if (r.reason instanceof WebPushError && GONE.has(r.reason.statusCode)) {
      gone.push(subs[i].id);
    } else {
      transient ??= r.reason;
    }
  });
  if (gone.length) await db.pushSubscription.deleteMany({ where: { id: { in: gone } } });
  if (ok.length) await db.pushSubscription.updateMany({ where: { id: { in: ok } }, data: { lastUsedAt: now } });

  if (!delivered) {
    if (transient) {
      await db.pushMessage.updateMany({ where: { id: msg.id }, data: { sentAt: null } });
      throw transient instanceof Error ? transient : new Error(`push to ${subs.length} device(s) failed`);
    }
    return drop("no-devices"); // every device unsubscribed
  }
  return { status: "sent", delivered, removed: gone.length };
}

/**
 * Cron `push.flush`: re-queue messages whose quiet hours / cap delay is over, retry orphans (queued
 * but never handled, e.g. the job failed for good) and delete stale unsent messages.
 */
export async function flushQueuedPush(now = new Date()): Promise<{ queued: number; stale: number }> {
  const stale = await db.pushMessage.deleteMany({ where: { sentAt: null, createdAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } } });
  // Only messages whose module the shop has; others expire through the stale cleanup above.
  const [alerts, auctions] = await Promise.all([tenantsWithModule("alerts"), tenantsWithModule("auctions")]);
  if (!alerts.size && !auctions.size) return { queued: 0, stale: stale.count };
  const due = await db.pushMessage.findMany({
    where: {
      sentAt: null,
      AND: [
        {
          OR: [
            { kind: { in: [...AUCTION_KINDS] }, tenantId: { in: [...auctions] } },
            { kind: { notIn: [...AUCTION_KINDS] }, tenantId: { in: [...alerts] } },
          ],
        },
      ],
      OR: [
        { queuedFor: { lte: now } },
        { queuedFor: null, createdAt: { lt: new Date(now.getTime() - 10 * 60 * 1000), gte: new Date(now.getTime() - 60 * 60 * 1000) } },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 1000,
  });
  for (const m of due) await enqueue("push.send", { messageId: m.id }, { singletonKey: m.id });
  return { queued: due.length, stale: stale.count };
}
