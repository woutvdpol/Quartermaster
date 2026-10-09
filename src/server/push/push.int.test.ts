import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { installHarness } from "../../../tests/integration/mail-harness";
import { makeProduct } from "../orders/test-fixtures";
import { matchProduct, processPriceDrop, sendDueDigests } from "@/server/alerts";
import { getPushPrefs, removePushSubscription, savePushSubscription, updatePushPrefs } from "./index";
import { scanEndingReservations } from "./reservations";
import { flushQueuedPush } from "./send";

const sendNotification = vi.fn();
vi.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  }
  return { default: { sendNotification: (...a: unknown[]) => sendNotification(...a) }, WebPushError };
});

let h: ReturnType<typeof installHarness>;
beforeEach(async () => {
  await resetDb();
  h = installHarness();
  vi.stubEnv("VAPID_PUBLIC_KEY", "BPublicKeyForTests");
  vi.stubEnv("VAPID_PRIVATE_KEY", "privateKeyForTests");
  vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.com");
  sendNotification.mockReset().mockResolvedValue({ statusCode: 201 });
});
afterEach(() => {
  h.uninstall();
  vi.unstubAllEnvs();
});

const HOUR = 60 * 60 * 1000;
const past = (ms: number) => new Date(Date.now() - ms);
const sub = (n = 1) => ({ endpoint: `https://push.example.test/sub/${n}`, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } });

async function shop() {
  const ctx = await createTenantContext();
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { timezone: "UTC" } });
  const c = await db.customer.create({ data: { tenantId: ctx.tenantId, email: "c@example.test" } });
  return { tenantId: ctx.tenantId, customerId: c.id, owner: { tenantId: ctx.tenantId, customerId: c.id } };
}

/** Quiet hours around the current UTC minute (the test tenant runs on UTC). */
function quietNow() {
  const m = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  return { quietStart: (m + 1440 - 60) % 1440, quietEnd: (m + 60) % 1440 };
}

describe("subscriptions + preferences", () => {
  it("upserts by endpoint, scopes removal to the customer, validates input", async () => {
    const { tenantId, owner } = await shop();
    const other = await db.customer.create({ data: { tenantId, email: "o@example.test" } });
    await savePushSubscription(owner, sub(1), { userAgent: "UA" });
    await savePushSubscription(owner, sub(1));
    expect(await db.pushSubscription.count()).toBe(1);
    // The same device logging in as someone else moves the subscription.
    await savePushSubscription({ tenantId, customerId: other.id }, sub(1));
    expect((await db.pushSubscription.findFirstOrThrow()).customerId).toBe(other.id);

    await expect(savePushSubscription(owner, { endpoint: "http://insecure.test/x", keys: sub().keys })).rejects.toThrow("Invalid push subscription");
    await expect(savePushSubscription({ tenantId, customerId: "nope" }, sub(2))).rejects.toThrow("Customer not found");

    expect(await removePushSubscription(owner, sub(1).endpoint)).toBe(0); // not theirs
    expect(await removePushSubscription({ tenantId, customerId: other.id }, sub(1).endpoint)).toBe(1);

    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    await expect(savePushSubscription(owner, sub(3))).rejects.toThrow("not available");
    expect((await getPushPrefs(owner)).available).toBe(false);
  });

  it("stores quiet hours, cap and toggles", async () => {
    const { owner } = await shop();
    await updatePushPrefs(owner, { quietStart: 22 * 60, quietEnd: 8 * 60, maxPerDay: 3, wishlist: false });
    expect(await getPushPrefs(owner)).toMatchObject({ quietStart: 1320, quietEnd: 480, maxPerDay: 3, wishlist: false, reservation: true, devices: 0 });
    await updatePushPrefs(owner, { quietStart: null, quietEnd: null });
    expect(await getPushPrefs(owner)).toMatchObject({ quietStart: null, quietEnd: null });
    await expect(updatePushPrefs(owner, { maxPerDay: 7 })).rejects.toThrow("Invalid maximum");
  });
});

describe("saved searches", () => {
  async function search(tenantId: string, customerId: string, opts: { push: boolean; frequency: "INSTANT" | "DAILY" }) {
    return db.savedSearch.create({
      data: { tenantId, customerId, email: "c@example.test", name: "M40 helmets", query: {}, ...opts, confirmedAt: past(HOUR), createdAt: past(HOUR) },
    });
  }
  async function publish(tenantId: string) {
    const p = await makeProduct(tenantId, { title: "Stahlhelm M40", price: 145000 });
    return db.product.update({ where: { id: p.id }, data: { publishedAt: new Date() } });
  }

  it("push + INSTANT replaces the instant mail; pushes once", async () => {
    const { tenantId, customerId, owner } = await shop();
    await savePushSubscription(owner, sub(1));
    await search(tenantId, customerId, { push: true, frequency: "INSTANT" });
    const p = await publish(tenantId);

    expect(await matchProduct(tenantId, p.id)).toMatchObject({ created: 1, instantMails: 0 });
    expect(h.jobs.map((j) => j.name)).toEqual(["push.send"]);
    await h.drain();
    expect(h.mails).toHaveLength(0);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toMatchObject({
      title: "New: Stahlhelm M40 — €1,450.00",
      url: `/product/${p.stockCode}/${p.slug}`,
    });
    const msg = await db.pushMessage.findFirstOrThrow();
    expect(msg).toMatchObject({ kind: "SAVED_SEARCH", customerId });
    expect(msg.sentAt).not.toBeNull();
    expect(await db.alertDelivery.count({ where: { sentAt: null } })).toBe(0);

    await matchProduct(tenantId, p.id); // bump / retry
    expect(await db.pushMessage.count()).toBe(1);
  });

  it("falls back to the instant mail without a device", async () => {
    const { tenantId, customerId } = await shop();
    await search(tenantId, customerId, { push: true, frequency: "INSTANT" });
    const p = await publish(tenantId);
    expect(await matchProduct(tenantId, p.id)).toMatchObject({ instantMails: 1 });
    expect(await db.pushMessage.count()).toBe(0);
  });

  it("push + DAILY pushes now and keeps the delivery for the digest", async () => {
    const { tenantId, customerId, owner } = await shop();
    await savePushSubscription(owner, sub(1));
    const s = await search(tenantId, customerId, { push: true, frequency: "DAILY" });
    const p = await publish(tenantId);
    await matchProduct(tenantId, p.id);
    expect(await db.pushMessage.count()).toBe(1);
    expect(await db.alertDelivery.count({ where: { savedSearchId: s.id, sentAt: null } })).toBe(1);
    await sendDueDigests({ tenantId, now: new Date(Date.now() + 25 * HOUR) });
    expect(await db.alertDelivery.count({ where: { savedSearchId: s.id, sentAt: null } })).toBe(0);
  });

  it("quiet hours hold the push back until the flush cron", async () => {
    const { tenantId, customerId, owner } = await shop();
    await savePushSubscription(owner, sub(1));
    await updatePushPrefs(owner, quietNow());
    await search(tenantId, customerId, { push: true, frequency: "INSTANT" });
    await matchProduct(tenantId, (await publish(tenantId)).id);
    await h.drain();
    expect(sendNotification).not.toHaveBeenCalled();
    const msg = await db.pushMessage.findFirstOrThrow();
    expect(msg.sentAt).toBeNull();
    expect(msg.queuedFor!.getTime()).toBeGreaterThan(Date.now());

    await updatePushPrefs(owner, { quietStart: null, quietEnd: null });
    await db.pushMessage.update({ where: { id: msg.id }, data: { queuedFor: past(1000) } });
    expect(await flushQueuedPush()).toMatchObject({ queued: 1 });
    await h.drain();
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
});

describe("wishlist price drop", () => {
  it("mails as before and pushes when opted in", async () => {
    const { tenantId, customerId, owner } = await shop();
    await savePushSubscription(owner, sub(1));
    const p = await makeProduct(tenantId, { price: 40000, title: "Feldbluse M36" });
    await db.wishlistItem.create({ data: { tenantId, customerId, productId: p.id } });
    expect(await processPriceDrop(tenantId, p.id, 50000, 40000)).toBe(1);
    expect((await db.pushMessage.findFirstOrThrow()).body).toBe("Feldbluse M36 is now €400.00 (was €500.00).");

    await updatePushPrefs(owner, { wishlist: false });
    await db.alertDelivery.deleteMany();
    await db.product.update({ where: { id: p.id }, data: { price: 30000 } });
    expect(await processPriceDrop(tenantId, p.id, 40000, 30000)).toBe(1); // mail still goes
    expect(await db.pushMessage.count()).toBe(1);
  });
});

describe("reservation ending", () => {
  async function cartWithHold(tenantId: string, customerId: string, opts: { expiresInMs: number; orderId?: string | null }) {
    const cart = await db.cart.create({ data: { tenantId, tokenHash: `h-${Math.random()}`, customerId, expiresAt: new Date(Date.now() + 30 * 24 * HOUR) } });
    const p = await makeProduct(tenantId);
    await db.reservation.create({ data: { tenantId, productId: p.id, cartId: cart.id, expiresAt: new Date(Date.now() + opts.expiresInMs) } });
    return cart;
  }

  it("warns once per cart, not in quiet hours, not without opt-in", async () => {
    const { tenantId, customerId, owner } = await shop();
    await savePushSubscription(owner, sub(1));
    const cart = await cartWithHold(tenantId, customerId, { expiresInMs: 2 * 60 * 1000 });
    await cartWithHold(tenantId, customerId, { expiresInMs: 10 * 60 * 1000 }); // other cart, not ending yet

    expect(await scanEndingReservations()).toEqual({ carts: 1, queued: 1 });
    expect(await scanEndingReservations()).toEqual({ carts: 1, queued: 0 }); // dedupe
    const msg = await db.pushMessage.findFirstOrThrow();
    expect(msg).toMatchObject({ kind: "RESERVATION_ENDING", url: "/cart" });
    expect(msg.dedupeKey).toMatch(new RegExp(`^reservation:${cart.id}:`));
    await h.drain();
    expect(sendNotification.mock.calls[0][2]).toMatchObject({ urgency: "high" });

    await db.pushMessage.deleteMany();
    await updatePushPrefs(owner, quietNow());
    expect(await scanEndingReservations()).toMatchObject({ queued: 0 });
    await updatePushPrefs(owner, { quietStart: null, quietEnd: null, reservation: false });
    expect(await scanEndingReservations()).toEqual({ carts: 0, queued: 0 });
  });
});
