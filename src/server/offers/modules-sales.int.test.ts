import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { decrypt } from "@/server/auth/encryption";
import { ServiceError, type ServiceContext } from "@/server/context";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { installHarness } from "../../../tests/integration/mail-harness";
import { makeProduct } from "@/server/orders/test-fixtures";
import { addFairItems, createFair, endFair, getFairSellData, listFairs, recordFairSale, startFair } from "@/server/fairs";
import { createCoupon, evaluateCoupon, listCoupons } from "@/server/coupons";
import { acceptOffer, expireOffers, getOfferCheckoutView, getOfferEligibility, listOffers, submitOffer } from "@/server/offers";

/*
 * Paid modules "fairs", "offers" and "coupons" (docs/modules.md § Eén controle, vijf plekken):
 * services refuse without the module (START has none of them), COMPLETE works, and activity that was
 * already running winds down (live fair can end, accepted offer stays buyable, the expire cron runs).
 */

let h: ReturnType<typeof installHarness>;

const code = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e) => (e instanceof ServiceError ? e.code : String(e)),
  );

async function offerProduct(tenantId: string, price = 10000) {
  const p = await makeProduct(tenantId, { price, title: "M40 helmet" });
  return db.product.update({ where: { id: p.id }, data: { acceptsOffers: true } });
}
const offerInput = (productId: string) => ({ productId, email: "collector@example.test", name: "Piet", amount: 8000 });

async function downgrade(ctx: ServiceContext) {
  await db.tenantPlan.update({ where: { tenantId: ctx.tenantId }, data: { plan: "START" } });
}

beforeEach(async () => {
  await resetDb();
  h = installHarness();
  process.env.MAIL_FROM_FALLBACK = "no-reply@quartermaster.test";
});
afterEach(() => h.uninstall());

describe("sales modules without entitlement (START)", () => {
  it("fairs admin calls reject with UNAVAILABLE", async () => {
    const ctx = await createTenantContext({ plan: "START" });
    expect(await code(createFair(ctx, { name: "Börse", startsOn: "2026-10-12", hideFromShop: true }))).toBe("UNAVAILABLE");
    expect(await code(listFairs(ctx))).toBe("UNAVAILABLE");
  });

  it("offers: storefront submit is refused as UNAVAILABLE, no button, admin list rejects", async () => {
    const ctx = await createTenantContext({ plan: "START" });
    const p = await offerProduct(ctx.tenantId);
    expect(await submitOffer(ctx.tenantId, offerInput(p.id))).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(await db.offer.count()).toBe(0);
    expect(await getOfferEligibility(ctx.tenantId, p.id)).toBeNull();
    expect(await code(listOffers(ctx))).toBe("UNAVAILABLE");
  });

  it("coupons: admin calls reject with UNAVAILABLE; an existing code evaluates as unknown", async () => {
    const ctx = await createTenantContext({ plan: "START" });
    expect(await code(createCoupon(ctx, { code: "TEN", type: "FIXED", value: 1000 }))).toBe("UNAVAILABLE");
    expect(await code(listCoupons(ctx))).toBe("UNAVAILABLE");
    await db.coupon.create({ data: { tenantId: ctx.tenantId, code: "TEN", type: "FIXED", value: 1000 } });
    expect(await evaluateCoupon(ctx.tenantId, "TEN", { subtotal: 5000, shippingPrice: 0, email: null })).toMatchObject({ ok: false, reason: "NOT_FOUND" });
  });
});

describe("sales modules with entitlement (COMPLETE)", () => {
  it("fairs, offers and coupons work", async () => {
    const ctx = await createTenantContext({ plan: "COMPLETE" });
    const fair = await createFair(ctx, { name: "Börse", startsOn: "2026-10-12", hideFromShop: true });
    expect((await listFairs(ctx)).map((f) => f.id)).toEqual([fair.id]);

    const p = await offerProduct(ctx.tenantId);
    expect(await getOfferEligibility(ctx.tenantId, p.id)).not.toBeNull();
    expect(await submitOffer(ctx.tenantId, offerInput(p.id))).toMatchObject({ ok: true, offerId: expect.any(String) });
    expect((await listOffers(ctx)).rows).toHaveLength(1);

    await createCoupon(ctx, { code: "TEN", type: "FIXED", value: 1000 });
    expect((await listCoupons(ctx)).total).toBe(1);
    expect(await evaluateCoupon(ctx.tenantId, "TEN", { subtotal: 5000, shippingPrice: 0, email: null })).toMatchObject({ ok: true, discount: 1000 });
  });
});

describe("wind-down after losing the modules", () => {
  it("a LIVE fair may finish: sell data, sales (incl. queued ones) and ending work; new activity doesn't", async () => {
    const ctx = await createTenantContext({ plan: "COMPLETE" });
    const sold = await makeProduct(ctx.tenantId, { price: 145000 });
    const unsold = await makeProduct(ctx.tenantId, { price: 90000 });
    const fair = await createFair(ctx, { name: "Börse", startsOn: "2026-10-12", hideFromShop: true });
    const next = await createFair(ctx, { name: "Next Börse", startsOn: "2026-11-12", hideFromShop: true });
    await addFairItems(ctx, fair.id, [sold.id, unsold.id]);
    await startFair(ctx, fair.id);
    expect((await db.product.findUniqueOrThrow({ where: { id: unsold.id } })).fairHoldId).toBe(fair.id);

    await downgrade(ctx);
    // new activity stays gated
    expect(await code(startFair(ctx, next.id))).toBe("UNAVAILABLE");
    expect(await code(getFairSellData(ctx, next.id))).toBe("UNAVAILABLE"); // not LIVE
    expect(await code(addFairItems(ctx, fair.id, [sold.id]))).toBe("UNAVAILABLE");

    // the running fair finishes
    expect((await getFairSellData(ctx, fair.id)).items).toHaveLength(2);
    const sale = await recordFairSale(ctx, { fairId: fair.id, productId: sold.id, price: 140000, method: "card", clientRef: "ref-wind-0001" });
    expect(sale).toMatchObject({ paymentStatus: "PAID", reused: false });
    expect(await recordFairSale(ctx, { fairId: fair.id, productId: sold.id, price: 140000, method: "card", clientRef: "ref-wind-0001" })).toMatchObject({ reused: true });

    expect(await endFair(ctx, fair.id)).toEqual({ released: 1 });
    expect((await db.product.findUniqueOrThrow({ where: { id: unsold.id } })).fairHoldId).toBeNull();
    expect(await code(getFairSellData(ctx, fair.id))).toBe("UNAVAILABLE"); // ENDED: fair mode closes
  });

  it("an accepted offer stays buyable and the expire cron keeps running", async () => {
    const ctx = await createTenantContext({ plan: "COMPLETE" });
    const p = await offerProduct(ctx.tenantId);
    const sub = await submitOffer(ctx.tenantId, offerInput(p.id));
    if (!sub.ok || !sub.offerId) throw new Error("submit failed");
    await acceptOffer(ctx, sub.offerId);
    const job = [...h.jobs].reverse().find((j) => (j.data as { template: string }).template === "offer-accepted");
    if (!job) throw new Error("no offer-accepted mail queued");
    const token = decrypt((job.data as { props: { tokenEnc: string } }).props.tokenEnc);

    await downgrade(ctx);
    expect(await code(acceptOffer(ctx, sub.offerId))).toBe("UNAVAILABLE");
    expect(await getOfferCheckoutView(ctx.tenantId, token)).toMatchObject({ state: "ready", agreedAmount: 8000 });
    await expect(expireOffers()).resolves.toMatchObject({ expired: 0 });
    expect((await db.offer.findUniqueOrThrow({ where: { id: sub.offerId } })).status).toBe("ACCEPTED");
  });
});
