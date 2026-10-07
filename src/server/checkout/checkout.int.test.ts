import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { encrypt } from "@/server/auth/encryption";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { makeProduct } from "@/server/orders/test-fixtures";
import { addToCart, extendReservations, getCart, removeFromCart, type ShopViewer } from "@/server/cart";
import { placeOrder, quoteCheckout, retryOrderPayment, simulateDevPayment, startOrderPayment, getOrderStatusView } from "./index";
import { clearPaymentMethodCache } from "./payment-methods";

const mollie = vi.hoisted(() => ({
  methods: { list: vi.fn() },
  payments: { create: vi.fn(), get: vi.fn(), cancel: vi.fn() },
}));

vi.mock("@mollie/api-client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@mollie/api-client")>();
  return { ...orig, default: vi.fn(() => ({ methods: mollie.methods, payments: mollie.payments })) };
});

const TEST_KEY = "test_abcdefghijklmnopqrstuvwxyz1234";

let tenantId: string;
let nl: { id: string };
let de: { id: string };
let pickup: { id: string };

async function setSettings(group: string, data: object) {
  await db.setting.upsert({
    where: { tenantId_group: { tenantId, group } },
    create: { tenantId, group, data },
    update: { data },
  });
}

async function configureMollie(methods: string[] = ["ideal", "creditcard"]) {
  await setSettings("payments", { mollie: { apiKeyEncrypted: encrypt(TEST_KEY), mode: "test", keyHint: "1234", verifiedAt: null, enabledMethods: methods } });
}

function input(over: Record<string, unknown> = {}) {
  return {
    email: "Buyer@Example.test",
    phone: "+31 6 12345678",
    shipping: { firstName: "Jan", lastName: "Jansen", street: "Damrak", houseNumber: "1", postalCode: "1012 LG", city: "Amsterdam", countryCode: "nl" },
    billingSameAsShipping: "on",
    shippingOptionId: nl.id,
    paymentMethod: "",
    termsAccepted: "on",
    ...over,
  };
}

async function cartWith(...productIds: string[]) {
  let token: string | null = null;
  for (const pid of productIds) {
    const r = await addToCart(tenantId, token, pid);
    token = r.token ?? token;
    expect(r.result.ok).toBe(true);
  }
  return token!;
}

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  clearPaymentMethodCache();
  ({ tenantId } = await createTenantContext());
  nl = await db.shippingZone.create({
    data: { tenantId, name: "Netherlands", countries: ["NL"], sortOrder: 0, rates: { create: [{ tenantId, maxWeightGrams: 5000, price: 695, insurancePrice: 250, maxInsuredValue: 500000 }] } },
  });
  de = await db.shippingZone.create({
    data: { tenantId, name: "Germany", countries: ["DE"], sortOrder: 1, rates: { create: [{ tenantId, maxWeightGrams: 5000, price: 1495 }] } },
  });
  pickup = await db.shippingZone.create({ data: { tenantId, name: "Pickup", countries: [], isPickup: true, sortOrder: 2 } });
});

describe("cart", () => {
  it("concurrent add-to-cart of the same unique product: exactly one cart wins", async () => {
    const p = await makeProduct(tenantId);
    const results = await Promise.all(Array.from({ length: 6 }, () => addToCart(tenantId, null, p.id)));
    const ok = results.filter((r) => r.result.ok);
    const refused = results.filter((r) => !r.result.ok);
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(5);
    for (const r of refused) {
      expect(r.result).toMatchObject({ ok: false, code: "RESERVED" });
      if (!r.result.ok) expect(r.result.message).toMatch(/Someone else has this in their cart — try again in \d+ min/);
    }
    expect(await db.reservation.count({ where: { productId: p.id, status: "ACTIVE" } })).toBe(1);
  });

  it("re-adding keeps one line and does not extend the hold; remove releases it", async () => {
    const p = await makeProduct(tenantId);
    const first = await addToCart(tenantId, null, p.id);
    const token = first.token!;
    const again = await addToCart(tenantId, token, p.id);
    expect(again.token).toBeNull();
    expect(again.result).toMatchObject({ ok: true, alreadyInCart: true });
    if (first.result.ok && again.result.ok) expect(again.result.expiresAt.getTime()).toBe(first.result.expiresAt.getTime());
    expect((await getCart(tenantId, token))!.lines).toHaveLength(1);

    await removeFromCart(tenantId, token, p.id);
    expect((await getCart(tenantId, token))!.lines).toHaveLength(0);
    expect(await db.reservation.count({ where: { productId: p.id, status: "ACTIVE" } })).toBe(0);
    // Now another visitor can take it.
    expect((await addToCart(tenantId, null, p.id)).result.ok).toBe(true);
  });

  it("flags lapsed / taken / unavailable lines without mutating on read; extendReservations re-reserves free ones", async () => {
    const a = await makeProduct(tenantId);
    const b = await makeProduct(tenantId);
    const c = await makeProduct(tenantId);
    const token = await cartWith(a.id, b.id, c.id);
    // a lapses and stays free; b lapses and is grabbed by someone else; c gets sold.
    await db.reservation.updateMany({ where: { productId: { in: [a.id, b.id] } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await addToCart(tenantId, null, b.id)).result.ok).toBe(true);
    await db.product.update({ where: { id: c.id }, data: { status: "SOLD", quantity: 0 } });

    const before = await db.reservation.findMany({ orderBy: { createdAt: "asc" } });
    const view = (await getCart(tenantId, token))!;
    expect(Object.fromEntries(view.lines.map((l) => [l.productId, l.state]))).toEqual({ [a.id]: "lapsed", [b.id]: "taken", [c.id]: "unavailable" });
    expect(view.buyableCount).toBe(1);
    expect(await db.reservation.findMany({ orderBy: { createdAt: "asc" } })).toEqual(before); // read-only

    const res = await extendReservations(tenantId, token);
    expect(res).toEqual({ reReserved: [a.id], taken: [b.id], unavailable: [c.id] });
    expect((await getCart(tenantId, token))!.lines.find((l) => l.productId === a.id)!.state).toBe("held");
  });

  it("isolates tenants: a cart token of shop A means nothing in shop B", async () => {
    const p = await makeProduct(tenantId);
    const token = await cartWith(p.id);
    const other = await createTenantContext();
    expect(await getCart(other.tenantId, token)).toBeNull();
    const foreign = await addToCart(other.tenantId, token, p.id);
    expect(foreign.result).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("guests can't add sensitive (blurred) items", async () => {
    const p = await db.product.update({ where: { id: (await makeProduct(tenantId)).id }, data: { blurred: true } });
    expect((await addToCart(tenantId, null, p.id)).result).toMatchObject({ ok: false, code: "LOGIN_REQUIRED" });
  });
});

describe("quote", () => {
  it("derives the zone from the country and applies the free-shipping threshold", async () => {
    const p = await makeProduct(tenantId, { price: 20000 });
    const token = await cartWith(p.id);
    const q = await quoteCheckout(tenantId, token, { countryCode: "NL" });
    expect(q.options.map((o) => o.id)).toEqual([nl.id, pickup.id]);
    expect(q.totals).toMatchObject({ subtotal: 20000, shipping: 695, total: 20695 });
    // Asking for the German option while shipping to NL selects nothing (no silent fallback).
    expect((await quoteCheckout(tenantId, token, { countryCode: "NL", shippingOptionId: de.id })).selectedOptionId).toBeNull();

    await setSettings("checkout", { freeShippingThresholdCents: 15000 });
    const free = await quoteCheckout(tenantId, token, { countryCode: "NL" });
    expect(free.totals.shipping).toBe(0);
    expect(free.freeShipping).toEqual({ threshold: 15000, remaining: 0, reached: true });
    const fr = await quoteCheckout(tenantId, token, { countryCode: "FR" });
    expect(fr.options.map((o) => o.id)).toEqual([pickup.id]);
    expect(fr.unavailableReason).toMatch(/don't ship/);
  });
});

describe("placeOrder", () => {
  it("creates the order with server-side totals, snapshots, addresses and hands the hold to the order", async () => {
    const p = await makeProduct(tenantId, { price: 12500, purchasePrice: 8000 });
    const token = await cartWith(p.id);
    const res = await placeOrder(
      tenantId,
      token,
      input({ insurance: "on", subtotal: 1, total: 1, price: 1, shippingTotal: 0, shipping: { ...input().shipping, price: 1 } }),
      null,
    );
    expect(res).toMatchObject({ ok: true, reused: false });
    if (!res.ok) return;
    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { lines: true, addresses: true, customer: true, events: true } });
    expect(order).toMatchObject({ subtotal: 12500, shippingTotal: 695 + 250, total: 12500 + 945, paymentStatus: "PENDING", shippingZoneId: nl.id, email: "buyer@example.test", currency: "EUR" });
    expect(order.lines[0]).toMatchObject({ productId: p.id, unitPrice: 12500, lineTotal: 12500, purchasePriceSnapshot: 8000 });
    expect(order.addresses.map((a) => a.type).sort()).toEqual(["BILLING", "SHIPPING"]);
    expect(order.addresses.every((a) => a.countryCode === "NL")).toBe(true);
    expect(order.customer?.email).toBe("buyer@example.test");
    expect(order.events.map((e) => e.type)).toEqual(["created"]);
    expect(order.number).toBeGreaterThan(0);

    const holds = await db.reservation.findMany({ where: { productId: p.id, status: "ACTIVE" } });
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ orderId: order.id, cartId: null });
    expect(holds[0].expiresAt.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
    expect((await getCart(tenantId, token))!.lines).toHaveLength(0);
    // Nobody else can grab it while the customer pays.
    expect((await addToCart(tenantId, null, p.id)).result).toMatchObject({ ok: false, code: "RESERVED" });
  });

  it("ignores client prices: a changed DB price is what gets charged", async () => {
    const p = await makeProduct(tenantId, { price: 10000 });
    const token = await cartWith(p.id);
    await db.product.update({ where: { id: p.id }, data: { price: 11000 } });
    const res = await placeOrder(tenantId, token, input({ total: 100 }), null);
    expect(res.ok).toBe(true);
    if (res.ok) expect(await db.order.findUniqueOrThrow({ where: { id: res.orderId } })).toMatchObject({ subtotal: 11000, total: 11695 });
  });

  it("uses the address country: a cheaper zone of another country is refused, never applied", async () => {
    const p = await makeProduct(tenantId);
    const token = await cartWith(p.id);
    const res = await placeOrder(tenantId, token, input({ shipping: { ...input().shipping, countryCode: "DE", postalCode: "10115", city: "Berlin" }, shippingOptionId: nl.id }), null);
    expect(res).toMatchObject({ ok: false, code: "SHIPPING", errors: { shippingOptionId: expect.any(String) } });
    const fr = await placeOrder(tenantId, token, input({ shipping: { ...input().shipping, countryCode: "FR" }, shippingOptionId: nl.id }), null);
    expect(fr).toMatchObject({ ok: false, code: "SHIPPING" });
    const ok = await placeOrder(tenantId, token, input({ shipping: { ...input().shipping, countryCode: "DE", postalCode: "10115", city: "Berlin" }, shippingOptionId: de.id }), null);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(await db.order.findUniqueOrThrow({ where: { id: ok.orderId } })).toMatchObject({ shippingTotal: 1495, shippingZoneName: "Germany" });
    expect(await db.order.count()).toBe(1);
  });

  it("compliance NO_SHIPPING: quote leaves only pickup, placing with delivery is refused per item", async () => {
    const restricted = await makeProduct(tenantId, { title: "Bayonet" });
    const plain = await makeProduct(tenantId, { title: "Cap" });
    await db.product.update({ where: { id: restricted.id }, data: { ageRestricted: true } });
    await db.complianceRule.create({ data: { tenantId, name: "No age items DE", match: "AGE_RESTRICTED", countries: ["DE"], action: "NO_SHIPPING" } });
    const token = await cartWith(restricted.id, plain.id);
    const de_ = { ...input().shipping, countryCode: "DE", postalCode: "10115", city: "Berlin" };

    const nlQuote = await quoteCheckout(tenantId, token, { countryCode: "NL" });
    expect(nlQuote.restrictedItems).toEqual([]);
    const deQuote = await quoteCheckout(tenantId, token, { countryCode: "DE" });
    expect(deQuote.restrictedItems).toEqual([{ productId: restricted.id, title: "Bayonet" }]);
    expect(deQuote.options.every((o) => o.isPickup)).toBe(true);
    expect(deQuote.unavailableReason).toMatch(/Can't be shipped to Germany.*Bayonet/);

    const refused = await placeOrder(tenantId, token, input({ ageConfirmed: "on", shipping: de_, shippingOptionId: de.id }), null);
    expect(refused).toMatchObject({ ok: false, code: "COMPLIANCE", blockedProductIds: [restricted.id], errors: { "shipping.countryCode": expect.stringContaining("Bayonet") } });
    expect(await db.order.count()).toBe(0);

    // Pickup is still allowed; so is delivery to a country without the rule.
    const viaPickup = await placeOrder(tenantId, token, input({ ageConfirmed: "on", shipping: de_, shippingOptionId: pickup.id }), null);
    expect(viaPickup.ok).toBe(true);
  });

  it("double submit (same key, concurrent) creates exactly one order", async () => {
    const p = await makeProduct(tenantId);
    const token = await cartWith(p.id);
    const body = input({ idempotencyKey: "key-12345678" });
    const results = await Promise.all([placeOrder(tenantId, token, body, null), placeOrder(tenantId, token, body, null), placeOrder(tenantId, token, body, null)]);
    expect(await db.order.count()).toBe(1);
    const uuids = new Set(results.map((r) => (r.ok ? r.uuid : r.code)));
    expect(uuids.size).toBe(1);
    expect(results.filter((r) => r.ok && r.reused)).toHaveLength(2);
    // Without a key, a resubmit against the now-empty cart returns the same pending order too.
    const again = await placeOrder(tenantId, token, input(), null);
    expect(again).toMatchObject({ ok: true, reused: true, uuid: [...uuids][0] });
    expect(await db.order.count()).toBe(1);
  });

  it("is blocked when an item is held by another cart, and rolls back completely", async () => {
    const a = await makeProduct(tenantId);
    const b = await makeProduct(tenantId, { title: "Helmet" });
    const token = await cartWith(a.id, b.id);
    await db.reservation.updateMany({ where: { productId: b.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await addToCart(tenantId, null, b.id)).result.ok).toBe(true); // someone else grabs b

    const res = await placeOrder(tenantId, token, input(), null);
    expect(res).toMatchObject({ ok: false, code: "UNAVAILABLE", blockedProductIds: [b.id] });
    if (!res.ok) expect(res.message).toContain("Helmet");
    expect(await db.order.count()).toBe(0);
    expect(await db.customer.count()).toBe(0);
    expect((await getCart(tenantId, token))!.lines).toHaveLength(2);
    expect(await db.reservation.findFirst({ where: { productId: a.id, status: "ACTIVE" } })).toMatchObject({ orderId: null });
  });

  it("re-reserves a lapsed but still free item at placement", async () => {
    const p = await makeProduct(tenantId);
    const token = await cartWith(p.id);
    await db.reservation.updateMany({ where: { productId: p.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await placeOrder(tenantId, token, input(), null);
    expect(res.ok).toBe(true);
    expect(await db.reservation.count({ where: { productId: p.id, status: "ACTIVE", orderId: { not: null } } })).toBe(1);
  });

  it("refuses sold items, validates fields, terms, age and login requirements", async () => {
    const p = await makeProduct(tenantId);
    const token = await cartWith(p.id);

    const bad = await placeOrder(tenantId, token, input({ email: "nope", termsAccepted: "", shipping: { ...input().shipping, postalCode: "" } }), null);
    expect(bad).toMatchObject({ ok: false, code: "INVALID" });
    if (!bad.ok) expect(Object.keys(bad.errors ?? {}).sort()).toEqual(["email", "shipping.postalCode", "termsAccepted"]);

    await db.product.update({ where: { id: p.id }, data: { ageRestricted: true } });
    await setSettings("legal", { ageVerification: "checkout" });
    expect(await placeOrder(tenantId, token, input(), null)).toMatchObject({ ok: false, errors: { ageConfirmed: expect.any(String) } });

    await db.product.update({ where: { id: p.id }, data: { blurred: true } });
    expect(await placeOrder(tenantId, token, input({ ageConfirmed: "on" }), null)).toMatchObject({ ok: false, code: "LOGIN_REQUIRED" });

    const user = await db.user.create({ data: { role: "CUSTOMER", tenantId, email: "member@example.test" } });
    const viewer: ShopViewer = { userId: user.id, email: user.email, name: null, customerId: null };
    const ok = await placeOrder(tenantId, token, input({ ageConfirmed: "on", email: "spoof@example.test" }), viewer);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const order = await db.order.findUniqueOrThrow({ where: { id: ok.orderId }, include: { customer: true, events: true } });
      expect(order.email).toBe("member@example.test");
      expect(order.customer?.userId).toBe(user.id);
      expect(order.events[0].data).toMatchObject({ ageConfirmed: true, guest: false });
    }

    const sold = await makeProduct(tenantId);
    const t2 = await cartWith(sold.id);
    await db.product.update({ where: { id: sold.id }, data: { status: "SOLD", quantity: 0 } });
    expect(await placeOrder(tenantId, t2, input(), null)).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });

  it("enforces the minimum order amount and the enabled payment methods", async () => {
    const p = await makeProduct(tenantId, { price: 1000 });
    const token = await cartWith(p.id);
    await setSettings("checkout", { minimumOrderCents: 5000 });
    expect(await placeOrder(tenantId, token, input(), null)).toMatchObject({ ok: false, code: "MINIMUM" });
    await setSettings("checkout", {});

    await configureMollie(["ideal"]);
    expect(await placeOrder(tenantId, token, input({ paymentMethod: "" }), null)).toMatchObject({ ok: false, errors: { paymentMethod: expect.any(String) } });
    expect(await placeOrder(tenantId, token, input({ paymentMethod: "paypal" }), null)).toMatchObject({ ok: false, errors: { paymentMethod: expect.any(String) } });
    const ok = await placeOrder(tenantId, token, input({ paymentMethod: "ideal" }), null);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect((await db.order.findUniqueOrThrow({ where: { id: ok.orderId } })).paymentMethod).toBe("ideal");
  });
});

describe("payment", () => {
  it("starts one Mollie payment per order and reuses the open one", async () => {
    await configureMollie(["ideal"]);
    const p = await makeProduct(tenantId);
    const token = await cartWith(p.id);
    const placed = await placeOrder(tenantId, token, input({ paymentMethod: "ideal" }), null);
    if (!placed.ok) throw new Error("placement failed");
    mollie.payments.create.mockImplementation(async (args: { redirectUrl: string; webhookUrl: string }) => ({
      id: "tr_abc12345",
      status: "open",
      method: null,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      getCheckoutUrl: () => "https://mollie.test/checkout/tr_abc12345",
      _args: args,
    }));
    const first = await startOrderPayment(tenantId, placed.orderId, { host: "shop.example.com" });
    const second = await startOrderPayment(tenantId, placed.orderId, { host: "shop.example.com" });
    expect(first).toEqual({ kind: "redirect", url: "https://mollie.test/checkout/tr_abc12345" });
    expect(second).toEqual(first);
    expect(mollie.payments.create).toHaveBeenCalledTimes(1);
    const args = mollie.payments.create.mock.calls[0][0];
    expect(args.redirectUrl).toMatch(new RegExp(`/order/${placed.uuid}$`));
    expect(args.webhookUrl).toMatch(new RegExp(`/api/webhooks/mollie/${tenantId}$`));
    expect(args.amount).toEqual({ currency: "EUR", value: "106.95" });
    expect(args.method).toBe("ideal");
  });

  it("dev simulation runs the real webhook path: paid → finalized, stock booked out, product sold", async () => {
    const p = await makeProduct(tenantId);
    const token = await cartWith(p.id);
    const placed = await placeOrder(tenantId, token, input(), null);
    if (!placed.ok) throw new Error("placement failed");
    expect((await getOrderStatusView(tenantId, placed.uuid))).toMatchObject({ state: "unpaid", devSimulation: true });
    await simulateDevPayment(tenantId, placed.uuid, "paid");
    const order = await db.order.findUniqueOrThrow({ where: { id: placed.orderId } });
    expect(order.paymentStatus).toBe("PAID");
    expect(order.finalizedAt).not.toBeNull();
    expect(await db.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "SOLD", quantity: 0 });
    expect(await getOrderStatusView(tenantId, placed.uuid)).toMatchObject({ state: "paid", devSimulation: false, canRetry: false });
    await expect(simulateDevPayment(tenantId, placed.uuid, "paid")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("dev simulation is refused when a Mollie key is configured", async () => {
    const p = await makeProduct(tenantId);
    const token = await cartWith(p.id);
    const placed = await placeOrder(tenantId, token, input(), null);
    if (!placed.ok) throw new Error("placement failed");
    await configureMollie();
    await expect(simulateDevPayment(tenantId, placed.uuid, "paid")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("retry: failed payment → retry re-reserves and resets to PENDING when items are still free", async () => {
    const p = await makeProduct(tenantId);
    const token = await cartWith(p.id);
    const placed = await placeOrder(tenantId, token, input(), null);
    if (!placed.ok) throw new Error("placement failed");
    await simulateDevPayment(tenantId, placed.uuid, "failed");
    expect(await db.reservation.count({ where: { productId: p.id, status: "ACTIVE" } })).toBe(0);
    expect(await getOrderStatusView(tenantId, placed.uuid)).toMatchObject({ state: "failed", canRetry: true });

    expect(await retryOrderPayment(tenantId, placed.uuid)).toEqual({ ok: true, orderId: placed.orderId });
    expect((await db.order.findUniqueOrThrow({ where: { id: placed.orderId } })).paymentStatus).toBe("PENDING");
    expect(await db.reservation.count({ where: { productId: p.id, status: "ACTIVE", orderId: placed.orderId } })).toBe(1);
    await simulateDevPayment(tenantId, placed.uuid, "paid");
    expect((await db.order.findUniqueOrThrow({ where: { id: placed.orderId } })).paymentStatus).toBe("PAID");
  });

  it("retry: refused when an item is now held by someone else (nothing changes)", async () => {
    const a = await makeProduct(tenantId);
    const b = await makeProduct(tenantId, { title: "Dagger" });
    const token = await cartWith(a.id, b.id);
    const placed = await placeOrder(tenantId, token, input(), null);
    if (!placed.ok) throw new Error("placement failed");
    await simulateDevPayment(tenantId, placed.uuid, "expired");
    expect((await addToCart(tenantId, null, b.id)).result.ok).toBe(true);

    expect(await getOrderStatusView(tenantId, placed.uuid)).toMatchObject({ state: "failed", canRetry: false, retryBlockedBy: ["Dagger"] });
    expect(await retryOrderPayment(tenantId, placed.uuid)).toMatchObject({ ok: false, reason: "unavailable", titles: ["Dagger"] });
    expect((await db.order.findUniqueOrThrow({ where: { id: placed.orderId } })).paymentStatus).toBe("EXPIRED");
    expect(await db.reservation.count({ where: { orderId: placed.orderId, status: "ACTIVE" } })).toBe(0);
  });

  it("retry: refused for shop-canceled, paid, too old or unknown orders", async () => {
    const p = await makeProduct(tenantId);
    const token = await cartWith(p.id);
    const placed = await placeOrder(tenantId, token, input(), null);
    if (!placed.ok) throw new Error("placement failed");
    await db.order.update({ where: { id: placed.orderId }, data: { paymentStatus: "CANCELED", canceledAt: new Date() } });
    expect(await retryOrderPayment(tenantId, placed.uuid)).toMatchObject({ ok: false, reason: "not_retryable" });
    await db.order.update({ where: { id: placed.orderId }, data: { paymentStatus: "FAILED", canceledAt: null, placedAt: new Date(Date.now() - 80 * 3600_000) } });
    expect(await retryOrderPayment(tenantId, placed.uuid)).toMatchObject({ ok: false, reason: "too_old" });
    await db.order.update({ where: { id: placed.orderId }, data: { paymentStatus: "PAID", placedAt: new Date() } });
    expect(await retryOrderPayment(tenantId, placed.uuid)).toMatchObject({ ok: false, reason: "not_retryable" });
    expect(await retryOrderPayment(tenantId, "00000000-0000-4000-8000-000000000000")).toMatchObject({ ok: false, reason: "not_found" });
    expect(await retryOrderPayment(tenantId, "12")).toMatchObject({ ok: false, reason: "not_found" });
    const other = await createTenantContext();
    expect(await retryOrderPayment(other.tenantId, placed.uuid)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await getOrderStatusView(other.tenantId, placed.uuid)).toBeNull();
  });

  it("order status view exposes no internal data", async () => {
    const p = await makeProduct(tenantId, { purchasePrice: 4321 });
    const token = await cartWith(p.id);
    const placed = await placeOrder(tenantId, token, input(), null);
    if (!placed.ok) throw new Error("placement failed");
    const view = await getOrderStatusView(tenantId, placed.uuid);
    const json = JSON.stringify(view);
    expect(json).not.toContain("4321");
    expect(json).not.toContain(placed.orderId);
    expect(json).not.toContain(p.id);
    expect(json).not.toContain("Damrak");
    expect(view!.email).toBe("bu***@example.test");
  });
});
