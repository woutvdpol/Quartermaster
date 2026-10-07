import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VERIFY_EMAIL_PATH } from "@/server/email-verification";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { login, requestPasswordReset, resetPassword } from "@/server/auth/service";
import { destroySession, getSession } from "@/server/auth/session";
import { encrypt } from "@/server/auth/encryption";
import { generateTotpSecret } from "@/server/auth/totp";
import { findOrCreateGuestCustomer } from "@/server/customers";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { enableNewsletter, installHarness, linkIn } from "../../../tests/integration/mail-harness";
import { makeOrder, makeProduct } from "../orders/test-fixtures";
import {
  changeCustomerEmail,
  createAddress,
  customerLogin,
  deleteAddress,
  deleteCustomerAccount,
  getShopCustomer,
  hasPendingCustomerTotp,
  listAddresses,
  listCustomerOrders,
  registerCustomer,
  REGISTER_RULE,
  setDefaultAddress,
  updateAddress,
} from "./index";

// The request's host decides the shop; tests switch it through this variable.
const host = vi.hoisted(() => ({ tenant: null as null | { id: string; timezone: string; currency: string } }));
vi.mock("@/server/tenant", () => ({
  getRequestTenant: async () => host.tenant,
  getRequestScope: async () => (host.tenant ? { kind: "tenant", tenant: host.tenant } : { kind: "unknown" }),
}));
// React's cache() memoizes per request in Next; outside a request, make it a no-op.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const PASSWORD = "correct horse battery";

async function shop(slug?: string) {
  const ctx = await createTenantContext(slug ? { slug } : {});
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  return { ctx, tenant };
}

function onHost(tenant: { id: string; timezone: string; currency: string } | null) {
  host.tenant = tenant;
}

/** Runs a server action that ends in redirect() and returns the target URL. */
async function redirectTarget(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw e;
  }
  throw new Error("expected a redirect");
}

beforeEach(async () => {
  await resetDb();
  await destroySession();
  onHost(null);
});

describe("registration", () => {
  it("creates a CUSTOMER account, signs it in and links the guest customer + guest orders", async () => {
    const { tenant } = await shop();
    const p = await makeProduct(tenant.id);
    // A previous guest checkout: linked guest Customer + one order without customerId (e.g. legacy import).
    const guest = await db.$transaction((tx) => findOrCreateGuestCustomer(tx, tenant.id, { email: "jan@example.test", name: "Jan Guest" }));
    const o1 = await makeOrder(tenant.id, { lines: [{ product: p }], customerId: guest.id, email: "jan@example.test" });
    const o2 = await makeOrder(tenant.id, { lines: [{ product: p }], customerId: null, email: "jan@example.test" });
    const other = await makeOrder(tenant.id, { lines: [{ product: p }], email: "someone@example.test" });

    const res = await registerCustomer({ tenantId: tenant.id, email: " Jan@Example.TEST ", name: "Jan Jansen", password: PASSWORD, ip: "10.0.0.1" });
    expect(res).toMatchObject({ ok: true, customerId: guest.id, linkedOrders: 1 });
    const user = await db.user.findUniqueOrThrow({ where: { tenantId_email: { tenantId: tenant.id, email: "jan@example.test" } } });
    expect(user).toMatchObject({ role: "CUSTOMER", tenantId: tenant.id, emailVerifiedAt: null, name: "Jan Jansen" });
    expect((await db.customer.findUniqueOrThrow({ where: { id: guest.id } })).userId).toBe(user.id);

    // Signed in right away, and the shop sees a logged-in customer.
    expect((await getSession())?.user.id).toBe(user.id);
    onHost(tenant);
    const me = await getShopCustomer();
    expect(me?.customer.id).toBe(guest.id);

    const orders = await listCustomerOrders({ tenantId: tenant.id, customerId: guest.id, email: user.email });
    expect(orders.map((o) => o.uuid).sort()).toEqual([o1.uuid, o2.uuid].sort());
    expect(orders.map((o) => o.uuid)).not.toContain(other.uuid);
    expect(Object.keys(orders[0]).sort()).toEqual(
      ["canceledAt", "currency", "firstItemTitle", "fulfillmentStatus", "itemCount", "number", "paymentStatus", "placedAt", "total", "uuid"].sort(),
    );
    expect(await db.auditLog.count({ where: { action: "customer.registered" } })).toBe(1);
  });

  it("validates, rejects taken emails (also staff emails) and rate-limits per IP", async () => {
    const { ctx, tenant } = await shop();
    const short = await registerCustomer({ tenantId: tenant.id, email: "x@example.test", name: "X", password: "short" });
    expect(short).toMatchObject({ ok: false, error: "invalid", fieldErrors: { password: expect.any(String) } });
    const bad = await registerCustomer({ tenantId: tenant.id, email: "nope", name: "", password: PASSWORD });
    expect(bad).toMatchObject({ ok: false, error: "invalid", fieldErrors: { email: expect.any(String), name: expect.any(String) } });

    await registerCustomer({ tenantId: tenant.id, email: "a@example.test", name: "A", password: PASSWORD });
    expect(await registerCustomer({ tenantId: tenant.id, email: "A@example.test", name: "A2", password: PASSWORD })).toEqual({ ok: false, error: "email_taken" });
    expect(await registerCustomer({ tenantId: tenant.id, email: ctx.actor.email, name: "Owner", password: PASSWORD })).toEqual({ ok: false, error: "email_taken" });

    for (let i = 0; i < REGISTER_RULE.limit; i++) {
      await registerCustomer({ tenantId: tenant.id, email: `r${i}@example.test`, name: "R", password: PASSWORD, ip: "10.9.9.9" });
    }
    expect(await registerCustomer({ tenantId: tenant.id, email: "late@example.test", name: "R", password: PASSWORD, ip: "10.9.9.9" })).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });

  it("newsletter opt-in starts double opt-in; the confirm link needs a POST", async () => {
    const h = installHarness();
    try {
      const { tenant } = await shop();
      await enableNewsletter(tenant.id);
      await db.tenantDomain.create({ data: { tenantId: tenant.id, host: "nl-shop.localhost:3000", isPrimary: true } });
      await registerCustomer({ tenantId: tenant.id, email: "news@example.test", name: "N", password: PASSWORD, newsletter: true });
      const sub = await db.newsletterSubscriber.findFirstOrThrow({ where: { tenantId: tenant.id } });
      expect(sub).toMatchObject({ email: "news@example.test", source: "register", confirmedAt: null });
      expect(sub.customerId).not.toBeNull();

      await h.drain();
      // Registration queues two mails: the newsletter confirmation and the e-mail verification.
      expect(h.mails).toHaveLength(2);
      const newsletterMail = h.mails.find((m) => String(m.html).includes("/newsletter/confirm"))!;
      expect(h.mails.some((m) => String(m.html).includes(VERIFY_EMAIL_PATH))).toBe(true);
      const link = linkIn(newsletterMail, "/newsletter/confirm");
      expect(link.pathname).toBe("/newsletter/confirm");
      const token = link.searchParams.get("token")!;

      // GET (page or legacy API link) never confirms.
      const { GET } = await import("@/app/api/newsletter/confirm/route");
      const fwd = GET(new Request(`http://nl-shop.localhost:3000/api/newsletter/confirm?token=${token}`));
      expect(fwd.headers.get("location")).toBe(`/newsletter/confirm?token=${token}`);
      expect((await db.newsletterSubscriber.findUniqueOrThrow({ where: { id: sub.id } })).confirmedAt).toBeNull();

      // The button (server action = POST) confirms — only on the subscriber's own shop host.
      const { confirmNewsletterAction } = await import("@/app/(shop)/newsletter/confirm/actions");
      const form = (t: string) => {
        const f = new FormData();
        f.set("token", t);
        return f;
      };
      const { tenant: otherShop } = await shop();
      onHost(otherShop);
      expect(await redirectTarget(confirmNewsletterAction(form(token)))).toBe("/newsletter?status=invalid");
      onHost(tenant);
      expect(await redirectTarget(confirmNewsletterAction(form(token)))).toBe("/newsletter?status=confirmed");
      expect((await db.newsletterSubscriber.findUniqueOrThrow({ where: { id: sub.id } })).confirmedAt).not.toBeNull();
      expect(await redirectTarget(confirmNewsletterAction(form(token)))).toBe("/newsletter?status=invalid");
    } finally {
      h.uninstall();
    }
  });
});

describe("shop login", () => {
  it("logs customers in; staff accounts get the generic error and no session", async () => {
    const { ctx, tenant } = await shop();
    await db.user.update({ where: { id: ctx.actor.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
    await registerCustomer({ tenantId: tenant.id, email: "c@example.test", name: "C", password: PASSWORD });
    await destroySession();

    expect(await customerLogin({ tenantId: tenant.id, email: ctx.actor.email, password: PASSWORD, ip: null })).toEqual({
      ok: false,
      error: "invalid_credentials",
    });
    expect(await getSession()).toBeNull();
    expect(await customerLogin({ tenantId: tenant.id, email: "c@example.test", password: "wrong password!", ip: null })).toEqual({
      ok: false,
      error: "invalid_credentials",
    });
    expect(await customerLogin({ tenantId: tenant.id, email: "c@example.test", password: PASSWORD, ip: null })).toEqual({ ok: true, next: "done" });
    onHost(tenant);
    expect((await getShopCustomer())?.user.email).toBe("c@example.test");

    // An OWNER signed in through the admin login is NOT a logged-in customer on the shop.
    expect(await login({ tenantId: tenant.id, email: ctx.actor.email, password: PASSWORD, ip: null })).toEqual({ ok: true, next: "done" });
    expect((await getSession())?.user.role).toBe("OWNER");
    expect(await getShopCustomer()).toBeNull();
  });

  it("supports a TOTP step for customers who enabled 2FA", async () => {
    const { tenant } = await shop();
    await registerCustomer({ tenantId: tenant.id, email: "t@example.test", name: "T", password: PASSWORD });
    await destroySession();
    await db.user.updateMany({ where: { email: "t@example.test" }, data: { totpSecretEnc: encrypt(generateTotpSecret()), totpEnabledAt: new Date() } });
    expect(await customerLogin({ tenantId: tenant.id, email: "t@example.test", password: PASSWORD, ip: null })).toEqual({ ok: true, next: "totp" });
    onHost(tenant);
    expect(await hasPendingCustomerTotp()).toBe(true);
    expect(await getShopCustomer()).toBeNull(); // not signed in until the code is verified
  });
});

describe("tenant isolation", () => {
  it("same email in two shops = two independent accounts", async () => {
    const a = await shop();
    const b = await shop();
    const ra = await registerCustomer({ tenantId: a.tenant.id, email: "same@example.test", name: "A", password: PASSWORD });
    const rb = await registerCustomer({ tenantId: b.tenant.id, email: "same@example.test", name: "B", password: "another password 2" });
    expect(ra.ok && rb.ok && ra.userId !== rb.userId && ra.customerId !== rb.customerId).toBe(true);

    // Shop A's password does not open the shop B account.
    await destroySession();
    expect(await customerLogin({ tenantId: b.tenant.id, email: "same@example.test", password: PASSWORD, ip: null })).toMatchObject({ ok: false });
    // A session of shop A's customer is a guest on shop B.
    expect(await customerLogin({ tenantId: a.tenant.id, email: "same@example.test", password: PASSWORD, ip: null })).toMatchObject({ ok: true });
    onHost(b.tenant);
    expect(await getShopCustomer()).toBeNull();
    onHost(a.tenant);
    expect((await getShopCustomer())?.tenant.id).toBe(a.tenant.id);

    // A reset token of shop A can't be redeemed on shop B.
    const token = (await requestPasswordReset(a.tenant.id, "same@example.test"))!;
    expect(await resetPassword(token, "brand new password", { tenantId: b.tenant.id })).toEqual({ ok: false, error: "invalid_token" });
    expect(await resetPassword(token, "brand new password", { tenantId: a.tenant.id })).toEqual({ ok: true });

    // Addresses: another customer's id is simply not found.
    const ownerA = { tenantId: a.tenant.id, customerId: (ra as { customerId: string }).customerId };
    const ownerB = { tenantId: b.tenant.id, customerId: (rb as { customerId: string }).customerId };
    const addr = await createAddress(ownerA, { firstName: "A", lastName: "B", street: "Kerkstraat", city: "Utrecht", countryCode: "nl" });
    expect(addr.ok).toBe(true);
    const id = (addr as { id: string }).id;
    expect(await deleteAddress(ownerB, id)).toEqual({ ok: false, error: "not_found" });
    expect(await updateAddress(ownerB, id, { firstName: "X", lastName: "Y", street: "S", city: "C", countryCode: "NL" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await listAddresses(ownerB)).toHaveLength(0);
  });
});

describe("account management", () => {
  it("address book keeps one default per type", async () => {
    const { tenant } = await shop();
    const r = await registerCustomer({ tenantId: tenant.id, email: "ad@example.test", name: "A D", password: PASSWORD });
    const owner = { tenantId: tenant.id, customerId: (r as { customerId: string }).customerId };
    const base = { firstName: "A", lastName: "D", street: "Main", city: "Utrecht", countryCode: "NL" };
    const first = (await createAddress(owner, base)) as { id: string };
    const second = (await createAddress(owner, { ...base, street: "Second" })) as { id: string };
    expect(await createAddress(owner, { ...base, countryCode: "XX" })).toMatchObject({ ok: false, fieldErrors: { countryCode: expect.any(String) } });
    let rows = await listAddresses(owner);
    expect(rows.find((a) => a.id === first.id)?.isDefault).toBe(true); // first of its type
    await setDefaultAddress(owner, second.id);
    rows = await listAddresses(owner);
    expect(rows.filter((a) => a.isDefault).map((a) => a.id)).toEqual([second.id]);
    await deleteAddress(owner, second.id);
    expect((await listAddresses(owner)).map((a) => [a.id, a.isDefault])).toEqual([[first.id, true]]);
  });

  it("email change needs the password and merges a guest record with that email", async () => {
    const { tenant } = await shop();
    const p = await makeProduct(tenant.id);
    const r = (await registerCustomer({ tenantId: tenant.id, email: "old@example.test", name: "O", password: PASSWORD })) as { userId: string; customerId: string };
    const guest = await db.$transaction((tx) => findOrCreateGuestCustomer(tx, tenant.id, { email: "new@example.test" }));
    const order = await makeOrder(tenant.id, { lines: [{ product: p }], customerId: guest.id, email: "new@example.test" });
    const user = { id: r.userId, tenantId: tenant.id, email: "old@example.test", role: "CUSTOMER" as const };

    expect(await changeCustomerEmail(user, "new@example.test", "wrong password")).toEqual({ ok: false, error: "invalid_password" });
    expect(await changeCustomerEmail(user, "new@example.test", PASSWORD)).toMatchObject({ ok: true });
    expect(await db.customer.findUnique({ where: { id: guest.id } })).toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).customerId).toBe(r.customerId);
    expect(await db.user.findUniqueOrThrow({ where: { id: r.userId } })).toMatchObject({ email: "new@example.test", emailVerifiedAt: null });

    await registerCustomer({ tenantId: tenant.id, email: "taken@example.test", name: "T", password: PASSWORD });
    expect(await changeCustomerEmail({ ...user, email: "new@example.test" }, "taken@example.test", PASSWORD)).toEqual({ ok: false, error: "email_taken" });
  });

  it("delete account anonymizes the customer, keeps orders and disables the login", async () => {
    const { tenant } = await shop();
    const p = await makeProduct(tenant.id);
    const r = (await registerCustomer({ tenantId: tenant.id, email: "del@example.test", name: "Del Me", password: PASSWORD })) as {
      userId: string;
      customerId: string;
    };
    const order = await makeOrder(tenant.id, { lines: [{ product: p }], customerId: r.customerId, email: "del@example.test", paymentStatus: "PAID" });
    const user = { id: r.userId, tenantId: tenant.id, email: "del@example.test", role: "CUSTOMER" as const };

    expect(await deleteCustomerAccount(user, "nope nope nope")).toEqual({ ok: false, error: "invalid_password" });
    expect(await deleteCustomerAccount(user, PASSWORD)).toEqual({ ok: true });
    expect(await getSession()).toBeNull();
    const u = await db.user.findUniqueOrThrow({ where: { id: r.userId } });
    expect(u.disabledAt).not.toBeNull();
    expect(u.passwordHash).toBeNull();
    expect(u.email).not.toContain("del@");
    const kept = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(kept.total).toBe(order.total);
    expect(kept.email).not.toBe("del@example.test");
    expect(await customerLogin({ tenantId: tenant.id, email: "del@example.test", password: PASSWORD, ip: null })).toMatchObject({ ok: false });
    // The email is free again for a new registration.
    expect(await registerCustomer({ tenantId: tenant.id, email: "del@example.test", name: "New", password: PASSWORD })).toMatchObject({ ok: true });
  });
});

afterEach(() => {
  onHost(null);
});
