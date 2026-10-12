import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { runJobNow } from "@/server/jobs/queue";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { installHarness } from "../../../tests/integration/mail-harness";
import { makeProduct } from "../orders/test-fixtures";
import { createLeadDraft, listLeads, submitLead } from "@/server/leads";
import { queuePush, savePushSubscription } from "@/server/push";
import { adminListSavedSearches, createSavedSearch, onPriceChanged, signAlertLink, unsubscribeSavedSearchSigned } from "./index";

/*
 * Paid modules `alerts` and `leads` (docs/modules.md § "Eén controle, vijf plekken"): a START shop has
 * neither, COMPLETE has both. Services refuse with UNAVAILABLE, jobs end quietly, opt-outs keep working.
 */

let h: ReturnType<typeof installHarness>;
beforeEach(async () => {
  await resetDb();
  h = installHarness();
  vi.stubEnv("VAPID_PUBLIC_KEY", "BPublicKeyForTests");
  vi.stubEnv("VAPID_PRIVATE_KEY", "privateKeyForTests");
  vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.com");
});
afterEach(() => {
  h.uninstall();
  vi.unstubAllEnvs();
});

const sub = { endpoint: "https://push.example.test/sub/1", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } };
const leadForm = { name: "Jan", email: "jan@example.test", phone: "", itemsDescription: "A Dutch M34 helmet with liner.", message: "", consent: true, photos: [] };

/** A wishlisted product whose price was just lowered 500 → 400. */
async function priceDropFixture(tenantId: string) {
  const c = await db.customer.create({ data: { tenantId, email: "c@example.test" } });
  const p = await makeProduct(tenantId, { price: 40000 });
  await db.wishlistItem.create({ data: { tenantId, customerId: c.id, productId: p.id } });
  return { customerId: c.id, productId: p.id };
}

describe("alerts module", () => {
  it("START: creating a saved search, admin list and push subscription are UNAVAILABLE", async () => {
    const ctx = await createTenantContext({ plan: "START" });
    await expect(createSavedSearch(ctx.tenantId, { email: "g@example.test", query: {} })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(adminListSavedSearches(ctx)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const c = await db.customer.create({ data: { tenantId: ctx.tenantId, email: "c@example.test" } });
    await expect(savePushSubscription({ tenantId: ctx.tenantId, customerId: c.id }, sub)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(await db.savedSearch.count()).toBe(0);
    expect(h.jobs).toHaveLength(0);
  });

  it("START: hooks enqueue nothing and a job handler does nothing", async () => {
    const ctx = await createTenantContext({ plan: "START" });
    const { productId } = await priceDropFixture(ctx.tenantId);
    await onPriceChanged(ctx.tenantId, productId, 50000, 40000);
    expect(h.jobs).toHaveLength(0);

    expect(await runJobNow("alerts.price-drop", { tenantId: ctx.tenantId, productId, oldPrice: 50000, newPrice: 40000 })).toEqual({ skipped: "module" });
    expect(await db.alertDelivery.count()).toBe(0);
    expect(h.jobs).toHaveLength(0);
  });

  it("START: the unsubscribe link of an existing search keeps working", async () => {
    const ctx = await createTenantContext({ plan: "START" });
    const s = await db.savedSearch.create({ data: { tenantId: ctx.tenantId, email: "a@example.test", name: "Old", query: {}, confirmedAt: new Date() } });
    const sig = signAlertLink("unsubscribe", ctx.tenantId, s.id);
    expect(await unsubscribeSavedSearchSigned({ tenantId: ctx.tenantId, savedSearchId: s.id, sig })).toEqual({ ok: true, changed: true });
  });

  it("COMPLETE: creating a saved search and the price-drop job work", async () => {
    const ctx = await createTenantContext({ plan: "COMPLETE" });
    expect(await createSavedSearch(ctx.tenantId, { email: "g@example.test", query: {} })).toEqual({ status: "pending" });
    expect((await adminListSavedSearches(ctx, { status: "pending" })).total).toBe(1);

    const { productId } = await priceDropFixture(ctx.tenantId);
    expect(await runJobNow("alerts.price-drop", { tenantId: ctx.tenantId, productId, oldPrice: 50000, newPrice: 40000 })).toEqual({ mails: 1 });
    expect(await db.alertDelivery.count({ where: { kind: "PRICE_DROP" } })).toBe(1);
  });
});

describe("web push: alerts or auctions", () => {
  it("START + auctions: subscribing works and auction pushes queue, alert pushes do not", async () => {
    const ctx = await createTenantContext({ plan: "START" });
    await db.tenantModule.create({ data: { tenantId: ctx.tenantId, moduleId: "auctions", status: "ACTIVE" } });
    const c = await db.customer.create({ data: { tenantId: ctx.tenantId, email: "c@example.test" } });
    await savePushSubscription({ tenantId: ctx.tenantId, customerId: c.id }, sub);
    expect(await db.pushSubscription.count({ where: { customerId: c.id } })).toBe(1);

    const base = { tenantId: ctx.tenantId, customerId: c.id, title: "T", body: "B", url: "/" };
    expect(await queuePush({ ...base, kind: "AUCTION_OUTBID", dedupeKey: "auction-outbid:lot1:1" })).toBe(true);
    expect(await queuePush({ ...base, kind: "SAVED_SEARCH", dedupeKey: "saved-search:d1" })).toBe(false);
    expect((await db.pushMessage.findMany({ select: { kind: true } })).map((m) => m.kind)).toEqual(["AUCTION_OUTBID"]);
    expect(h.jobs.map((j) => j.name)).toEqual(["push.send"]);
  });
});

describe("leads module", () => {
  it("START: submitting a lead and the admin list are UNAVAILABLE", async () => {
    const ctx = await createTenantContext({ plan: "START" });
    const draft = createLeadDraft(ctx.tenantId);
    await expect(submitLead({ tenantId: ctx.tenantId, draftToken: draft, data: leadForm, ip: null, turnstileToken: null })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    await expect(listLeads(ctx)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(await db.lead.count()).toBe(0);
    expect(h.jobs).toHaveLength(0);
  });

  it("COMPLETE: submitting a lead works", async () => {
    const ctx = await createTenantContext({ plan: "COMPLETE" });
    const res = await submitLead({ tenantId: ctx.tenantId, draftToken: createLeadDraft(ctx.tenantId), data: leadForm, ip: null, turnstileToken: null });
    expect(res.ok).toBe(true);
    expect((await listLeads(ctx)).total).toBe(1);
  });
});
