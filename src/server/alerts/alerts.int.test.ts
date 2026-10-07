import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { installHarness, linkIn } from "../../../tests/integration/mail-harness";
import { makeProduct } from "../orders/test-fixtures";
import {
  adminAlertStats,
  adminDisableSavedSearch,
  adminListSavedSearches,
  confirmSavedSearch,
  createSavedSearch,
  deleteCustomerSearch,
  listCustomerSearches,
  manageViewSigned,
  matchProduct,
  onPriceChanged,
  onProductPublished,
  processBackAvailable,
  processPriceDrop,
  queryFromCatalogInput,
  runMatchingNow,
  scanReleasedReservations,
  sendDueDigests,
  stopFromManageLink,
  stopWishlistAlertSigned,
  unsubscribeSavedSearchSigned,
  MAX_ACTIVE_PER_EMAIL,
} from "./index";

let h: ReturnType<typeof installHarness>;
beforeEach(async () => {
  await resetDb();
  h = installHarness();
});
afterEach(() => h.uninstall());

const past = (ms: number) => new Date(Date.now() - ms);
const HOUR = 60 * 60 * 1000;

async function shop() {
  const ctx = await createTenantContext();
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { timezone: "UTC" } });
  await db.tenantDomain.create({ data: { tenantId: ctx.tenantId, host: `${ctx.tenantId}.localhost:3000`, isPrimary: true } });
  const root = await db.category.create({ data: { tenantId: ctx.tenantId, title: "Helmets", slug: "helmets" } });
  const child = await db.category.create({ data: { tenantId: ctx.tenantId, title: "M35", slug: "m35", parentId: root.id } });
  const other = await db.category.create({ data: { tenantId: ctx.tenantId, title: "Medals", slug: "medals" } });
  return { ctx, tenantId: ctx.tenantId, root, child, other };
}

async function customer(tenantId: string, email = "c@example.test") {
  return db.customer.create({ data: { tenantId, email } });
}

/** A product published now, in the given category. */
async function publish(tenantId: string, opts: { categoryId?: string | null; title?: string; price?: number } = {}) {
  const p = await makeProduct(tenantId, opts);
  return db.product.update({ where: { id: p.id }, data: { publishedAt: new Date() } });
}

/** Active (confirmed) saved search created an hour ago. */
async function activeSearch(tenantId: string, query: object, opts: { frequency?: "INSTANT" | "DAILY" | "WEEKLY"; email?: string } = {}) {
  return db.savedSearch.create({
    data: {
      tenantId,
      email: opts.email ?? "a@example.test",
      name: "Search",
      query,
      frequency: opts.frequency ?? "INSTANT",
      confirmedAt: past(HOUR),
      createdAt: past(HOUR),
    },
  });
}

describe("saved searches: create + double opt-in", () => {
  it("guest → confirmation mail → POST confirm; customer is active at once", async () => {
    const { tenantId, root } = await shop();
    const query = await queryFromCatalogInput(tenantId, { categoryId: root.id, min: 100, max: 500, q: " m35 " });
    expect(query).toMatchObject({ categoryId: root.id, priceMin: 10000, priceMax: 50000, q: "m35" });

    const res = await createSavedSearch(tenantId, { email: " Guest@Example.TEST ", query, frequency: "DAILY" }, { ip: "1.2.3.4" });
    expect(res).toEqual({ status: "pending" });
    const row = await db.savedSearch.findFirstOrThrow({ where: { tenantId } });
    expect(row).toMatchObject({ email: "guest@example.test", confirmedAt: null, name: "Helmets · “m35” · 100–500" });
    expect(h.jobs[0]).toMatchObject({ name: "mail.send", options: { inTransaction: true }, data: { template: "alert-confirm" } });

    await h.drain();
    expect(h.mails).toHaveLength(1);
    const token = linkIn(h.mails[0], "/alerts/confirm").searchParams.get("token")!;
    expect(await confirmSavedSearch(token, { tenantId: "other-tenant" })).toEqual({ ok: false, error: "invalid" });
    expect(await confirmSavedSearch(token, { tenantId })).toMatchObject({ ok: true });
    expect(await confirmSavedSearch(token, { tenantId })).toEqual({ ok: false, error: "invalid" }); // single use
    expect((await db.savedSearch.findUniqueOrThrow({ where: { id: row.id } })).confirmedAt).not.toBeNull();

    // Same search again by a guest: neutral answer, no new row.
    expect(await createSavedSearch(tenantId, { email: "guest@example.test", query })).toEqual({ status: "pending" });
    expect(await db.savedSearch.count()).toBe(1);

    const c = await customer(tenantId);
    const created = await createSavedSearch(tenantId, { customerId: c.id, email: "ignored@x.test", query, name: "My helmets", frequency: "INSTANT" });
    expect(created.status).toBe("created");
    const mine = await listCustomerSearches({ tenantId, customerId: c.id });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ name: "My helmets", status: "active", frequency: "INSTANT" });
    expect(mine[0].description.href).toBe("/shop/category/helmets?q=m35&min=100&max=500");
    expect(await createSavedSearch(tenantId, { customerId: c.id, query })).toMatchObject({ status: "duplicate" });
    expect(await deleteCustomerSearch({ tenantId, customerId: "someone-else" }, mine[0].id)).toBe(false);
    expect(await deleteCustomerSearch({ tenantId, customerId: c.id }, mine[0].id)).toBe(true);
  });

  it("expired confirmation tokens are rejected", async () => {
    const { tenantId } = await shop();
    await createSavedSearch(tenantId, { email: "g@example.test", query: {} });
    await h.drain();
    const token = linkIn(h.mails[0], "/alerts/confirm").searchParams.get("token")!;
    await db.savedSearch.updateMany({ data: { createdAt: past(8 * 24 * HOUR) } });
    expect(await confirmSavedSearch(token, { tenantId })).toMatchObject({ ok: false, error: "expired" });
  });

  it("rate limits per email and per IP; max active per email", async () => {
    const { tenantId } = await shop();
    for (let i = 0; i < 5; i++) {
      expect(await createSavedSearch(tenantId, { email: "spam@example.test", query: { q: `w${i}` } })).toEqual({ status: "pending" });
    }
    expect(await createSavedSearch(tenantId, { email: "spam@example.test", query: { q: "w9" } })).toEqual({ status: "rate_limited" });

    for (let i = 0; i < 20; i++) await createSavedSearch(tenantId, { email: `ip${i}@example.test`, query: {} }, { ip: "9.9.9.9" });
    expect(await createSavedSearch(tenantId, { email: "fresh@example.test", query: {} }, { ip: "9.9.9.9" })).toEqual({ status: "rate_limited" });

    const c = await customer(tenantId, "many@example.test");
    for (let i = 0; i < MAX_ACTIVE_PER_EMAIL; i++) {
      expect((await createSavedSearch(tenantId, { customerId: c.id, query: { q: `x${i}` } })).status).toBe("created");
    }
    expect(await createSavedSearch(tenantId, { customerId: c.id, query: { q: "one-more" } })).toEqual({ status: "limit" });
  });
});

describe("matching", () => {
  it("matches descendants, dedupes per (search, product), INSTANT mails at once, skips older searches", async () => {
    const { tenantId, root, child, other } = await shop();
    const instant = await activeSearch(tenantId, { categoryId: root.id }, { frequency: "INSTANT", email: "i@example.test" });
    const daily = await activeSearch(tenantId, { categoryId: root.id }, { frequency: "DAILY", email: "d@example.test" });
    const p = await publish(tenantId, { categoryId: child.id, title: "M35 helmet" });
    const miss = await publish(tenantId, { categoryId: other.id });

    expect(await matchProduct(tenantId, p.id)).toEqual({ matched: 2, created: 2, instantMails: 1 });
    expect(await matchProduct(tenantId, p.id)).toEqual({ matched: 2, created: 0, instantMails: 0 }); // idempotent (bump/retry)
    expect(await matchProduct(tenantId, miss.id)).toMatchObject({ matched: 0 });

    await h.drain();
    expect(h.mails).toHaveLength(1);
    const mail = h.mails[0];
    expect(mail.to).toBe("i@example.test");
    expect(mail.subject).toContain("M35 helmet");
    expect(mail.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(String(mail.html)).toContain(`/product/${p.stockCode}/`);
    expect(await db.alertDelivery.count({ where: { savedSearchId: daily.id, sentAt: null } })).toBe(1);
    expect((await db.savedSearch.findUniqueOrThrow({ where: { id: instant.id } })).lastNotifiedAt).not.toBeNull();

    // A search created after publication does not get the existing stock.
    const late = await db.savedSearch.create({ data: { tenantId, email: "l@example.test", name: "Late", query: {}, confirmedAt: new Date() } });
    await matchProduct(tenantId, p.id);
    expect(await db.alertDelivery.count({ where: { savedSearchId: late.id } })).toBe(0);
  });

  it("the hook enqueues a job that matches", async () => {
    const { tenantId, root } = await shop();
    await activeSearch(tenantId, { categoryId: root.id });
    const p = await publish(tenantId, { categoryId: root.id });
    await onProductPublished(tenantId, p.id);
    expect(h.jobs.map((j) => j.name)).toEqual(["alerts.match-product"]);
    await h.drain();
    expect(h.mails).toHaveLength(1);
  });

  it("does not match unconfirmed, unsubscribed or unavailable", async () => {
    const { tenantId } = await shop();
    await db.savedSearch.create({ data: { tenantId, email: "p@example.test", name: "Pending", query: {}, createdAt: past(HOUR) } });
    await db.savedSearch.create({ data: { tenantId, email: "u@example.test", name: "Off", query: {}, createdAt: past(HOUR), confirmedAt: past(HOUR), unsubscribedAt: past(1000) } });
    const p = await publish(tenantId);
    expect(await matchProduct(tenantId, p.id)).toMatchObject({ matched: 0 });
    await activeSearch(tenantId, {});
    await db.product.update({ where: { id: p.id }, data: { status: "DRAFT" } });
    expect(await matchProduct(tenantId, p.id)).toMatchObject({ matched: 0 });
  });

  it("digest bundles DAILY deliveries created before the 07:00 slot into one mail", async () => {
    const { ctx, tenantId } = await shop();
    const s = await activeSearch(tenantId, {}, { frequency: "DAILY", email: "d@example.test" });
    const a = await publish(tenantId, { title: "First" });
    const b = await publish(tenantId, { title: "Second" });
    const r = await runMatchingNow(ctx, { days: 1 }); // also tries digests: deliveries are newer than today's slot
    expect(r).toMatchObject({ products: 2, created: 2, instantMails: 0 });
    expect(h.mails).toHaveLength(0);

    const tomorrow7 = new Date(Date.now() + 24 * HOUR);
    tomorrow7.setUTCHours(7, 30, 0, 0);
    expect(await sendDueDigests({ now: tomorrow7 })).toEqual({ searches: 1, mails: 1 });
    expect(await sendDueDigests({ now: tomorrow7 })).toEqual({ searches: 0, mails: 0 }); // nothing left
    await h.drain();
    expect(h.mails).toHaveLength(1);
    expect(h.mails[0].subject).toContain("2 new items");
    const text = String(h.mails[0].html);
    expect(text).toContain("First");
    expect(text).toContain("Second");
    expect(await db.alertDelivery.count({ where: { savedSearchId: s.id, sentAt: null } })).toBe(0);
    expect([a.id, b.id]).toHaveLength(2);
  });

  it("a sold item is left out of the digest; nothing left → no mail", async () => {
    const { tenantId } = await shop();
    await activeSearch(tenantId, {}, { frequency: "DAILY" });
    const p = await publish(tenantId);
    await matchProduct(tenantId, p.id);
    await db.product.update({ where: { id: p.id }, data: { status: "SOLD", quantity: 0 } });
    const later = new Date(Date.now() + 25 * HOUR);
    later.setUTCHours(8, 0, 0, 0);
    expect((await sendDueDigests({ now: later })).mails).toBe(1);
    await h.drain();
    expect(h.mails).toHaveLength(0); // builder skipped
  });
});

describe("unsubscribe + manage", () => {
  it("signed one-click unsubscribe, manage link lists and stops all of one address", async () => {
    const { tenantId } = await shop();
    const s1 = await activeSearch(tenantId, { q: "a" }, { email: "m@example.test" });
    const s2 = await activeSearch(tenantId, { q: "b" }, { email: "m@example.test" });
    await activeSearch(tenantId, { q: "c" }, { email: "other@example.test" });
    const p = await publish(tenantId, { title: "a b c" });
    await matchProduct(tenantId, p.id);
    await h.drain();
    const mail = h.mails.find((m) => m.to === "m@example.test" && String(m.html).includes(s1.id))!;
    const unsub = linkIn(mail, "/alerts/unsubscribe");
    const manage = linkIn(mail, "/alerts/manage");
    const sig = unsub.searchParams.get("sig")!;

    expect(await unsubscribeSavedSearchSigned({ tenantId, savedSearchId: s2.id, sig })).toEqual({ ok: false, error: "invalid" });
    expect(await unsubscribeSavedSearchSigned({ tenantId, savedSearchId: s1.id, sig })).toEqual({ ok: true, changed: true });
    expect(await unsubscribeSavedSearchSigned({ tenantId, savedSearchId: s1.id, sig })).toEqual({ ok: true, changed: false });

    const anchor = { tenantId, savedSearchId: manage.searchParams.get("s")!, sig: manage.searchParams.get("sig")! };
    const view = await manageViewSigned(anchor);
    expect(view?.email).toBe("m•••@example.test");
    expect(view?.searches.map((s) => s.id)).toEqual([s2.id]);
    expect(await manageViewSigned({ ...anchor, sig })).toBeNull(); // unsubscribe sig is not a manage sig
    expect(await stopFromManageLink({ ...anchor, targetId: null })).toEqual({ ok: true, changed: true });
    expect(await db.savedSearch.count({ where: { tenantId, unsubscribedAt: null } })).toBe(1); // other@ untouched
  });
});

describe("wishlist alerts", () => {
  it("back available: free again → one mail per cooldown; held or sold → none", async () => {
    const { tenantId } = await shop();
    const c = await customer(tenantId, "w@example.test");
    const holder = await customer(tenantId, "h@example.test");
    const p = await makeProduct(tenantId, { title: "Badge" });
    await db.wishlistItem.create({ data: { tenantId, customerId: c.id, productId: p.id } });
    await db.wishlistItem.create({ data: { tenantId, customerId: holder.id, productId: p.id } });

    const res = await db.reservation.create({ data: { tenantId, productId: p.id, expiresAt: new Date(Date.now() + 60_000) } });
    expect(await processBackAvailable(tenantId, p.id)).toBe(0); // still held
    await db.reservation.update({ where: { id: res.id }, data: { status: "RELEASED", releasedAt: new Date() } });

    expect(await scanReleasedReservations()).toEqual({ products: 1, mails: 2 });
    expect(await processBackAvailable(tenantId, p.id)).toBe(0); // cooldown
    await h.drain();
    expect(h.mails.map((m) => m.to).sort()).toEqual(["h@example.test", "w@example.test"]);
    const mail = h.mails.find((m) => m.to === "w@example.test")!;
    expect(mail.subject).toBe("Available again: Badge");

    // After the cooldown it can notify again, but not the excluded customer.
    await db.alertDelivery.updateMany({ data: { sentAt: past(25 * HOUR) } });
    expect(await processBackAvailable(tenantId, p.id, { excludeCustomerId: holder.id })).toBe(1);

    // Stop link removes the item from the wishlist.
    const stop = linkIn(mail, "/alerts/unsubscribe");
    const q = Object.fromEntries(stop.searchParams);
    expect(await stopWishlistAlertSigned({ tenantId, customerId: q.c, productId: q.p, sig: "bad" })).toMatchObject({ ok: false });
    expect(await stopWishlistAlertSigned({ tenantId, customerId: q.c, productId: q.p, sig: q.sig })).toEqual({ ok: true, changed: true });
    expect(await db.wishlistItem.count({ where: { customerId: c.id } })).toBe(0);
  });

  it("price drop: only decreases, ACTIVE only, re-notifies after 7 days", async () => {
    const { tenantId } = await shop();
    const c = await customer(tenantId);
    const p = await makeProduct(tenantId, { price: 50000 });
    await db.wishlistItem.create({ data: { tenantId, customerId: c.id, productId: p.id } });

    await onPriceChanged(tenantId, p.id, 50000, 60000);
    expect(h.jobs).toHaveLength(0); // increase: nothing
    await db.product.update({ where: { id: p.id }, data: { price: 40000 } });
    await onPriceChanged(tenantId, p.id, 50000, 40000);
    await h.drain();
    expect(h.mails).toHaveLength(1);
    expect(h.mails[0].subject).toContain("€400.00");
    expect(await processPriceDrop(tenantId, p.id, 40000, 35000)).toBe(0); // within 7 days (and price not lowered yet)
    await db.product.update({ where: { id: p.id }, data: { price: 35000 } });
    expect(await processPriceDrop(tenantId, p.id, 40000, 35000)).toBe(0); // cooldown
    await db.alertDelivery.updateMany({ data: { sentAt: past(8 * 24 * HOUR) } });
    expect(await processPriceDrop(tenantId, p.id, 40000, 35000)).toBe(1);
    expect(await db.alertDelivery.count()).toBe(1); // one row, re-armed
    await db.product.update({ where: { id: p.id }, data: { status: "SOLD", quantity: 0 } });
    await db.alertDelivery.updateMany({ data: { sentAt: past(8 * 24 * HOUR) } });
    expect(await processPriceDrop(tenantId, p.id, 35000, 30000)).toBe(0);
  });
});

describe("tenant isolation + admin", () => {
  it("other shops' searches, ids and admin views stay separate", async () => {
    const a = await shop();
    const b = await shop();
    const sa = await activeSearch(a.tenantId, { categoryId: a.root.id });
    await activeSearch(b.tenantId, {});
    // Foreign category id is dropped when resolving a query for shop B.
    expect((await queryFromCatalogInput(b.tenantId, { categoryId: a.root.id })).categoryId).toBeNull();

    const pa = await publish(a.tenantId, { categoryId: a.root.id });
    expect(await matchProduct(b.tenantId, pa.id)).toMatchObject({ matched: 0 }); // product of A, matched as B
    expect(await matchProduct(a.tenantId, pa.id)).toMatchObject({ matched: 1 });
    expect(await db.alertDelivery.count({ where: { tenantId: b.tenantId } })).toBe(0);

    expect(await adminDisableSavedSearch(b.ctx, sa.id)).toBe(false);
    const list = await adminListSavedSearches(a.ctx);
    expect(list.items.map((r) => r.id)).toEqual([sa.id]);
    expect(list.items[0].emailMasked).toBe("a•••@example.test");
    const stats = await adminAlertStats(a.ctx);
    expect(stats).toMatchObject({ activeSearches: 1, topCategories: [{ id: a.root.id, title: "Helmets", count: 1 }] });
    expect(stats.deliveries30d.savedSearch).toBe(1);
    expect(await adminDisableSavedSearch(a.ctx, sa.id)).toBe(true);
    expect((await adminAlertStats(a.ctx)).activeSearches).toBe(0);
  });
});
