import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { encrypt } from "@/server/auth/encryption";
import { ServiceError, type ServiceContext } from "@/server/context";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { makeProduct } from "@/server/orders/test-fixtures";
import { addToCart } from "@/server/cart";
import { getPaymentSurcharges, getSurchargeRules, setPaymentSurcharges } from "@/server/payments/mollie-config";
import { handleMollieWebhook } from "@/server/payments/mollie";
import { loadOrderMailData } from "@/server/mail/order-data";
import { getOrderStatusView, getPaymentSetup, placeOrder, quoteCheckout, startOrderPayment } from "./index";
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
const PAYPAL = { percentBps: 500, fixed: 0, cap: null, label: "PayPal fee" };

let ctx: ServiceContext;
let tenantId: string;
let nl: { id: string };

async function configure(t: string, methods: string[] = ["ideal", "paypal"]) {
  const data = { mollie: { apiKeyEncrypted: encrypt(TEST_KEY), mode: "test", keyHint: "1234", verifiedAt: null, enabledMethods: methods } };
  await db.setting.upsert({ where: { tenantId_group: { tenantId: t, group: "payments" } }, create: { tenantId: t, group: "payments", data }, update: { data } });
}

async function zone(t: string) {
  return db.shippingZone.create({ data: { tenantId: t, name: "Netherlands", countries: ["NL"], rates: { create: [{ tenantId: t, maxWeightGrams: 5000, price: 695 }] } } });
}

async function cartWith(t: string, ...productIds: string[]) {
  let token: string | null = null;
  for (const pid of productIds) {
    const r = await addToCart(t, token, pid);
    token = r.token ?? token;
    expect(r.result.ok).toBe(true);
  }
  return token!;
}

function input(over: Record<string, unknown> = {}) {
  return {
    email: "buyer@example.test",
    phone: "+31 6 12345678",
    shipping: { firstName: "Jan", lastName: "Jansen", street: "Damrak", houseNumber: "1", postalCode: "1012 LG", city: "Amsterdam", countryCode: "NL" },
    billingSameAsShipping: "on",
    shippingOptionId: nl.id,
    paymentMethod: "paypal",
    termsAccepted: "on",
    ...over,
  };
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e) => (e instanceof ServiceError ? e.code : `THREW ${String(e)}`),
  );

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  clearPaymentMethodCache();
  ctx = await createTenantContext();
  tenantId = ctx.tenantId;
  nl = await zone(tenantId);
  await configure(tenantId);
});

describe("surcharge configuration", () => {
  it("validates, drops empty rules, audits, and leaves the Mollie key alone", async () => {
    expect(await code(setPaymentSurcharges(ctx, { bitcoinz: PAYPAL }))).toBe("INVALID");
    expect(await code(setPaymentSurcharges(ctx, { paypal: { ...PAYPAL, percentBps: 2500 } }))).toBe("INVALID");
    expect(await code(setPaymentSurcharges(ctx, { paypal: { ...PAYPAL, label: "" } }))).toBe("INVALID");

    const saved = await setPaymentSurcharges(ctx, { paypal: PAYPAL, ideal: { percentBps: 0, fixed: 0, cap: null, label: "x" } });
    expect(saved).toEqual({ paypal: PAYPAL });
    expect(await getPaymentSurcharges(ctx)).toEqual({ paypal: PAYPAL });
    const row = await db.setting.findUniqueOrThrow({ where: { tenantId_group: { tenantId, group: "payments" } } });
    expect((row.data as { mollie: { apiKeyEncrypted: string } }).mollie.apiKeyEncrypted).toBeTruthy();
    const audits = await db.auditLog.findMany({ where: { tenantId, action: "payments.surcharges_update" } });
    expect(audits).toHaveLength(1);
    await setPaymentSurcharges(ctx, { paypal: PAYPAL }); // unchanged → no second audit row
    expect(await db.auditLog.count({ where: { tenantId, action: "payments.surcharges_update" } })).toBe(1);
  });

  it("is per tenant", async () => {
    const other = await createTenantContext();
    await setPaymentSurcharges(ctx, { paypal: PAYPAL });
    expect(await getSurchargeRules(other.tenantId)).toEqual({});
    await configure(other.tenantId);
    const setup = await getPaymentSetup(other.tenantId);
    expect(setup.methods.find((m) => m.id === "paypal")?.surcharge).toBeNull();
    expect((await getPaymentSetup(tenantId)).methods.find((m) => m.id === "paypal")?.surcharge).toEqual(PAYPAL);
  });
});

describe("checkout with a surcharge", () => {
  beforeEach(async () => {
    await setPaymentSurcharges(ctx, { paypal: PAYPAL });
  });

  it("quotes the surcharge only for the chosen method (re-quote on method change)", async () => {
    const p = await makeProduct(tenantId, { price: 10000 });
    const token = await cartWith(tenantId, p.id);
    const base = { countryCode: "NL", shippingOptionId: nl.id };

    const none = await quoteCheckout(tenantId, token, base);
    expect(none.totals).toMatchObject({ total: 10695, surcharge: 0, surchargeLabel: null });
    const paypal = await quoteCheckout(tenantId, token, { ...base, paymentMethod: "paypal" });
    expect(paypal.totals).toMatchObject({ subtotal: 10000, shippingTotal: 695, surcharge: 535, surchargeLabel: "PayPal fee", total: 11230 }); // 534.75 → 535
    expect(paypal.paymentMethod).toBe("paypal");
    const ideal = await quoteCheckout(tenantId, token, { ...base, paymentMethod: "ideal" });
    expect(ideal.totals).toMatchObject({ surcharge: 0, total: 10695 });
    expect(ideal.paymentMethod).toBeNull();
  });

  it("places the order with the server-computed surcharge (half up), snapshot, and a Mollie payment for the full total restricted to the method", async () => {
    const p = await makeProduct(tenantId, { price: 10015 }); // base 10 710 → 535.5 → 536
    const token = await cartWith(tenantId, p.id);
    const placed = await placeOrder(tenantId, token, { ...input(), surchargeTotal: 0, total: 1 }, null); // extra client fields are ignored
    if (!placed.ok) throw new Error(placed.message);

    const order = await db.order.findUniqueOrThrow({ where: { id: placed.orderId } });
    expect(order).toMatchObject({ subtotal: 10015, shippingTotal: 695, surchargeTotal: 536, total: 11246, paymentMethod: "paypal", surchargeLabel: "PayPal fee" });
    expect(order.surchargeDetail).toEqual({ method: "paypal", label: "PayPal fee", percentBps: 500, fixed: 0, cap: null, base: 10710, amount: 536, rounding: "half-up" });
    const created = await db.orderEvent.findFirstOrThrow({ where: { orderId: order.id, type: "created" } });
    expect((created.data as { surcharge: unknown }).surcharge).toMatchObject({ method: "paypal", amount: 536 });

    mollie.payments.create.mockResolvedValue({
      id: "tr_sur00001",
      status: "open",
      method: null,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      getCheckoutUrl: () => "https://mollie.test/checkout/tr_sur00001",
    });
    await startOrderPayment(tenantId, order.id, { host: "shop.example.com" });
    const args = mollie.payments.create.mock.calls[0][0];
    expect(args.amount).toEqual({ currency: "EUR", value: "112.46" });
    expect(args.method).toBe("paypal"); // no switching to a method without the surcharge on Mollie's page

    // The webhook verifies against the full total (incl. surcharge) and marks it paid.
    mollie.payments.get.mockResolvedValue({
      id: "tr_sur00001",
      mode: "test",
      status: "paid",
      method: "paypal",
      amount: { value: "112.46", currency: "EUR" },
      metadata: { tenantId, orderId: order.id, orderNumber: order.number },
      paidAt: new Date().toISOString(),
    });
    expect(await handleMollieWebhook(tenantId, "tr_sur00001")).toMatchObject({ outcome: "processed", result: { orderStatus: "PAID" } });

    // Customer-facing surfaces show the labelled line.
    expect(await getOrderStatusView(tenantId, order.uuid)).toMatchObject({ surchargeTotal: 536, surchargeLabel: "PayPal fee", total: 11246 });
    expect(await loadOrderMailData(tenantId, order.id, "https://shop.test")).toMatchObject({ surchargeTotal: 536, surchargeLabel: "PayPal fee" });
  });

  it("charges nothing for a method without a rule", async () => {
    const p = await makeProduct(tenantId, { price: 10000 });
    const token = await cartWith(tenantId, p.id);
    const placed = await placeOrder(tenantId, token, input({ paymentMethod: "ideal" }), null);
    if (!placed.ok) throw new Error(placed.message);
    const order = await db.order.findUniqueOrThrow({ where: { id: placed.orderId } });
    expect(order).toMatchObject({ surchargeTotal: 0, surchargeLabel: null, surchargeDetail: null, total: 10695 });
  });

  it("does not leak to another tenant's checkout", async () => {
    const other = await createTenantContext();
    await configure(other.tenantId);
    const otherZone = await zone(other.tenantId);
    const p = await makeProduct(other.tenantId, { price: 10000 });
    const token = await cartWith(other.tenantId, p.id);
    const placed = await placeOrder(other.tenantId, token, input({ shippingOptionId: otherZone.id }), null);
    if (!placed.ok) throw new Error(placed.message);
    expect(await db.order.findUniqueOrThrow({ where: { id: placed.orderId } })).toMatchObject({ surchargeTotal: 0, total: 10695, paymentMethod: "paypal" });
  });
});
