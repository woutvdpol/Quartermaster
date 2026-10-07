import { beforeEach, describe, expect, it, vi } from "vitest";
import { MollieApiError } from "@mollie/api-client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { makeOrder, makeProduct } from "@/server/orders/test-fixtures";
import { getMollieCredentials, getMollieStatus, listMollieMethods, removeMollieKey, saveMollieKey, setEnabledMethods } from "./mollie-config";
import { createMolliePayment, handleMollieWebhook, MollieWebhookRetryableError } from "./mollie";
import { POST } from "@/app/api/webhooks/mollie/[tenant]/route";

const mollie = vi.hoisted(() => ({
  keys: [] as string[],
  methods: { list: vi.fn() },
  payments: { create: vi.fn(), get: vi.fn(), cancel: vi.fn() },
}));

vi.mock("@mollie/api-client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@mollie/api-client")>();
  return {
    ...orig,
    default: vi.fn((opts: { apiKey: string }) => {
      mollie.keys.push(opts.apiKey);
      return { methods: mollie.methods, payments: mollie.payments };
    }),
  };
});

const TEST_KEY = "test_abcdefghijklmnopqrstuvwxyz1234";
const LIVE_KEY = "live_ABCDEFGHIJKLMNOPQRSTUVWXYZ9876";

const method = (id: string) => ({
  id,
  description: id.toUpperCase(),
  image: { size1x: "", size2x: "", svg: `https://mollie.test/${id}.svg` },
  minimumAmount: { value: "0.01", currency: "EUR" },
  maximumAmount: null,
});

function molliePayment(over: Record<string, unknown> = {}) {
  const p = {
    id: "tr_test12345",
    mode: "test",
    status: "open",
    amount: { value: "106.95", currency: "EUR" },
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    metadata: {},
    details: { consumerName: "SECRET PERSON", consumerAccount: "NL00BANK0123456789" },
    ...over,
  };
  return { ...p, getCheckoutUrl: () => `https://mollie.test/checkout/${p.id}` };
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e) => (e instanceof ServiceError ? e.code : `THREW ${String(e)}`),
  );

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  mollie.keys.length = 0;
  mollie.methods.list.mockResolvedValue([method("ideal"), method("creditcard"), method("bancontact")]);
});

describe("Mollie config", () => {
  it("rejects malformed keys without calling Mollie", async () => {
    const ctx = await createTenantContext();
    expect(await code(saveMollieKey(ctx, "sk_live_nope"))).toBe("INVALID");
    expect(await code(saveMollieKey(ctx, "test_short"))).toBe("INVALID");
    expect(mollie.methods.list).not.toHaveBeenCalled();
  });

  it("maps verification failures: 401 → INVALID, outage → UNAVAILABLE; nothing stored", async () => {
    const ctx = await createTenantContext();
    mollie.methods.list.mockRejectedValueOnce(new MollieApiError("Unauthorized", { statusCode: 401 }));
    expect(await code(saveMollieKey(ctx, TEST_KEY))).toBe("INVALID");
    mollie.methods.list.mockRejectedValueOnce(new MollieApiError("fetch failed"));
    expect(await code(saveMollieKey(ctx, TEST_KEY))).toBe("UNAVAILABLE");
    expect((await getMollieStatus(ctx)).configured).toBe(false);
  });

  it("stores the key encrypted, shows it masked and never audits it", async () => {
    const ctx = await createTenantContext();
    const status = await saveMollieKey(ctx, `  ${LIVE_KEY} `);
    expect(mollie.keys).toEqual([LIVE_KEY]);
    expect(status).toMatchObject({ configured: true, mode: "live", maskedKey: "live_••••••••9876", enabledMethods: [] });
    expect(status.verifiedAt).toBeTruthy();

    const row = await db.setting.findUniqueOrThrow({ where: { tenantId_group: { tenantId: ctx.tenantId, group: "payments" } } });
    expect(JSON.stringify(row.data)).not.toContain(LIVE_KEY.slice(5));
    expect((await getMollieCredentials(ctx.tenantId))?.apiKey).toBe(LIVE_KEY);

    const audits = await db.auditLog.findMany({ where: { tenantId: ctx.tenantId } });
    expect(audits.map((a) => a.action)).toEqual(["payments.mollie.key_saved"]);
    expect(JSON.stringify(audits.map((a) => a.data))).not.toContain(LIVE_KEY.slice(5));

    expect(await removeMollieKey(ctx)).toMatchObject({ configured: false, maskedKey: null, mode: null });
    expect(await getMollieCredentials(ctx.tenantId)).toBeNull();
  });

  it("lists and restricts methods", async () => {
    const ctx = await createTenantContext();
    expect(await code(listMollieMethods(ctx))).toBe("CONFLICT");
    expect(await code(setEnabledMethods(ctx, ["ideal"]))).toBe("CONFLICT");
    await saveMollieKey(ctx, TEST_KEY);

    expect((await listMollieMethods(ctx)).every((m) => m.enabled)).toBe(true);
    expect(await code(setEnabledMethods(ctx, ["bitcoinz"]))).toBe("INVALID");
    expect(await code(setEnabledMethods(ctx, ["paypal"]))).toBe("INVALID"); // known, but not active on the account
    expect((await setEnabledMethods(ctx, ["IDEAL", "creditcard", "ideal"])).enabledMethods).toEqual(["ideal", "creditcard"]);
    const listed = await listMollieMethods(ctx);
    expect(listed.map((m) => [m.id, m.enabled])).toEqual([
      ["ideal", true],
      ["creditcard", true],
      ["bancontact", false],
    ]);
    expect(listed[0].imageUrl).toBe("https://mollie.test/ideal.svg");
    expect((await setEnabledMethods(ctx, [])).enabledMethods).toEqual([]);
  });

  it("isolates tenants", async () => {
    const a = await createTenantContext();
    const b = await createTenantContext();
    await saveMollieKey(a, TEST_KEY);
    expect((await getMollieStatus(b)).configured).toBe(false);
    expect(await getMollieCredentials(b.tenantId)).toBeNull();
  });
});

describe("Mollie payments + webhook", () => {
  async function setup(opts: { configure?: boolean } = {}) {
    const ctx = await createTenantContext();
    if (opts.configure !== false) await saveMollieKey(ctx, TEST_KEY);
    const product = await makeProduct(ctx.tenantId, { price: 10000 });
    const order = await makeOrder(ctx.tenantId, { lines: [{ product }], reserve: true });
    return { ctx, product, order };
  }
  const urls = { redirectUrl: "https://shop.test/order/return", webhookUrl: "https://shop.test/api/webhooks/mollie/shop" };

  it("creates a Mollie payment from the order row", async () => {
    const { ctx, order } = await setup();
    await setEnabledMethods(ctx, ["ideal", "bancontact"]);
    mollie.payments.create.mockResolvedValue(molliePayment({ metadata: { tenantId: ctx.tenantId, orderId: order.id } }));

    const created = await createMolliePayment(ctx.tenantId, { id: order.id }, urls);
    expect(created).toMatchObject({ providerPaymentId: "tr_test12345", checkoutUrl: "https://mollie.test/checkout/tr_test12345", status: "OPEN" });
    expect(mollie.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: { currency: "EUR", value: (order.total / 100).toFixed(2) },
        description: `Order ${order.number}`,
        method: ["ideal", "bancontact"],
        metadata: { tenantId: ctx.tenantId, orderId: order.id, orderNumber: order.number },
        ...urls,
      }),
    );
    const payment = await db.payment.findUniqueOrThrow({ where: { id: created.paymentId } });
    expect(payment).toMatchObject({ tenantId: ctx.tenantId, orderId: order.id, provider: "MOLLIE", amount: order.total, currency: "EUR" });
    expect(JSON.stringify(payment.raw)).not.toContain("SECRET PERSON");

    expect(await code(createMolliePayment(ctx.tenantId, { id: order.id }, { ...urls, method: "creditcard" }))).toBe("INVALID");
    expect(await code(createMolliePayment(ctx.tenantId, { id: order.id }, { ...urls, webhookUrl: "javascript:alert(1)" }))).toBe("INVALID");
  });

  it("refuses unpayable orders, other tenants' orders and unconfigured shops", async () => {
    const { ctx, product } = await setup();
    const paid = await makeOrder(ctx.tenantId, { lines: [{ product }], paymentStatus: "PAID" });
    expect(await code(createMolliePayment(ctx.tenantId, { id: paid.id }, urls))).toBe("CONFLICT");
    const other = await setup();
    expect(await code(createMolliePayment(ctx.tenantId, { id: other.order.id }, urls))).toBe("NOT_FOUND");
    const unconfigured = await setup({ configure: false });
    expect(await code(createMolliePayment(unconfigured.ctx.tenantId, { id: unconfigured.order.id }, urls))).toBe("UNAVAILABLE");
    expect(mollie.payments.create).not.toHaveBeenCalled();
  });

  it("cancels the Mollie payment when storing the attempt fails", async () => {
    const { ctx, order } = await setup();
    await makeOrder(ctx.tenantId, { lines: [{ product: await makeProduct(ctx.tenantId) }], molliePaymentId: "tr_taken0001" });
    mollie.payments.create.mockResolvedValue(molliePayment({ id: "tr_taken0001" }));
    mollie.payments.cancel.mockResolvedValue(undefined);
    await expect(createMolliePayment(ctx.tenantId, { id: order.id }, urls)).rejects.toThrow();
    expect(mollie.payments.cancel).toHaveBeenCalledWith("tr_taken0001");
  });

  it("webhook re-fetches the status from Mollie and marks the order paid (idempotent)", async () => {
    const { ctx, order } = await setup();
    await db.payment.create({ data: { tenantId: ctx.tenantId, orderId: order.id, provider: "MOLLIE", providerPaymentId: "tr_paid0001", amount: order.total, currency: "EUR" } });
    const paidAt = new Date("2026-10-07T12:00:00Z");
    mollie.payments.get.mockResolvedValue(molliePayment({ id: "tr_paid0001", status: "paid", method: "ideal", paidAt: paidAt.toISOString() }));

    const out = await handleMollieWebhook(ctx.tenantId, "tr_paid0001");
    expect(mollie.payments.get).toHaveBeenCalledWith("tr_paid0001");
    expect(out).toMatchObject({ outcome: "processed", result: { orderId: order.id, orderStatus: "PAID", changed: true } });
    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.paymentStatus).toBe("PAID");
    const p = await db.payment.findFirstOrThrow({ where: { providerPaymentId: "tr_paid0001" } });
    expect(p).toMatchObject({ status: "PAID", method: "ideal" });
    expect(JSON.stringify(p.raw)).not.toContain("NL00BANK");

    expect(await handleMollieWebhook(ctx.tenantId, "tr_paid0001")).toMatchObject({ outcome: "processed", result: { changed: false } });
  });

  it("ignores unknown, malformed and foreign ids; retries on transient errors", async () => {
    const a = await setup();
    const b = await setup();
    expect(await handleMollieWebhook(a.ctx.tenantId, "not-an-id")).toEqual({ outcome: "ignored", reason: "INVALID_ID" });
    expect(mollie.payments.get).not.toHaveBeenCalled();

    mollie.payments.get.mockRejectedValueOnce(new MollieApiError("Not found", { statusCode: 404 }));
    expect(await handleMollieWebhook(a.ctx.tenantId, "tr_unknown01")).toEqual({ outcome: "ignored", reason: "UNKNOWN_PAYMENT" });

    // B's payment posted to A's webhook URL (same Mollie account): no row for A → ignored, B untouched.
    await db.payment.create({ data: { tenantId: b.ctx.tenantId, orderId: b.order.id, provider: "MOLLIE", providerPaymentId: "tr_ofb00001", amount: 1, currency: "EUR" } });
    mollie.payments.get.mockResolvedValueOnce(molliePayment({ id: "tr_ofb00001", status: "paid", metadata: { tenantId: b.ctx.tenantId, orderId: b.order.id } }));
    expect(await handleMollieWebhook(a.ctx.tenantId, "tr_ofb00001")).toEqual({ outcome: "ignored", reason: "UNKNOWN_PAYMENT" });
    expect((await db.order.findUniqueOrThrow({ where: { id: b.order.id } })).paymentStatus).toBe("PENDING");

    // Webhook raced our own Payment insert → retry.
    mollie.payments.get.mockResolvedValueOnce(molliePayment({ id: "tr_race0001", status: "paid", metadata: { tenantId: a.ctx.tenantId, orderId: a.order.id } }));
    await expect(handleMollieWebhook(a.ctx.tenantId, "tr_race0001")).rejects.toBeInstanceOf(MollieWebhookRetryableError);

    mollie.payments.get.mockRejectedValueOnce(new MollieApiError("fetch failed"));
    await expect(handleMollieWebhook(a.ctx.tenantId, "tr_whatever1")).rejects.toBeInstanceOf(MollieWebhookRetryableError);

    const unconfigured = await setup({ configure: false });
    expect(await handleMollieWebhook(unconfigured.ctx.tenantId, "tr_whatever1")).toEqual({ outcome: "ignored", reason: "NOT_CONFIGURED" });
  });

  describe("POST /api/webhooks/mollie/[tenant]", () => {
    const post = (slug: string, body: string) =>
      POST(new Request(`http://localhost/api/webhooks/mollie/${slug}`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } }), {
        params: Promise.resolve({ tenant: slug }),
      } as RouteContext<"/api/webhooks/mollie/[tenant]">);

    it("answers 200 for unknown tenants/ids, processes known ones, 500 on transient errors", async () => {
      const { ctx, order } = await setup();
      const tenant = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
      expect((await post("no-such-shop", "id=tr_abc12345")).status).toBe(200);
      expect((await post(tenant.id, "")).status).toBe(200);
      expect((await post(tenant.id, "id=bogus")).status).toBe(200);

      await db.payment.create({ data: { tenantId: ctx.tenantId, orderId: order.id, provider: "MOLLIE", providerPaymentId: "tr_route001", amount: order.total, currency: "EUR" } });
      // Body status is ignored: only the id is read, Mollie says "paid".
      mollie.payments.get.mockResolvedValueOnce(molliePayment({ id: "tr_route001", status: "paid" }));
      const res = await post(tenant.id, "id=tr_route001&status=failed");
      expect(res.status).toBe(200);
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PAID");

      mollie.payments.get.mockRejectedValueOnce(new MollieApiError("Bad gateway", { statusCode: 502 }));
      expect((await post(tenant.id, "id=tr_route002")).status).toBe(500);
    });
  });
});
