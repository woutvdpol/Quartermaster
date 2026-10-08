import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { AuthError } from "@/server/auth/guards";
import { ServiceError, type ServiceContext } from "@/server/context";
import { getSettings } from "@/server/settings";
import { verifyPassword } from "@/server/auth/password";
import type { PlatformContext } from "@/server/platform";
import {
  acceptDealerInvite,
  applyShippingTemplate,
  approveApplication,
  completeSetup,
  createLegalPages,
  getGoLiveChecklist,
  getPendingSetup,
  listApplications,
  markSetupStep,
  rejectApplication,
  requestOwnDomain,
  resendDealerInvite,
  saveBasicsStep,
  saveBusinessStep,
  submitApplication,
  verifyApplicationEmail,
} from "@/server/onboarding";
import { createTenantContext, resetDb } from "./helpers";
import { installHarness, linkIn } from "./mail-harness";

let h: ReturnType<typeof installHarness>;
beforeEach(async () => {
  await resetDb();
  h = installHarness();
  process.env.MAIL_FROM_FALLBACK = "no-reply@quartermaster.test";
  process.env.SHOP_SUBDOMAIN_BASE = "shops.test";
  process.env.PLATFORM_HOST = "platform.test";
  delete process.env.APP_URL;
});
afterEach(() => h.uninstall());

const application = {
  applicantName: "Jan de Vries",
  email: "jan@vries.example",
  shopName: "Vries Militaria",
  country: "NL",
  cocNumber: "12345678",
  currentPlatform: "woocommerce",
  description: "WW2 helmets, uniforms and insignia, about 300 pieces.",
  legalConsent: true,
};

let ipCounter = 0;
const nextIp = () => `10.0.0.${++ipCounter % 250}`;

async function superadmin(): Promise<PlatformContext> {
  const u = await db.user.create({ data: { role: "SUPERADMIN", tenantId: null, email: `root-${Math.random().toString(36).slice(2)}@qm.test` } });
  return { actor: { id: u.id, role: u.role, tenantId: null, email: u.email } };
}

async function submit(data: Record<string, unknown> = application) {
  return submitApplication({ data, ip: nextIp(), turnstileToken: null });
}

/** Submits, drains the verify mail and returns the verification token from its link. */
async function submitAndGetToken(data: Record<string, unknown> = application) {
  expect(await submit(data)).toEqual({ ok: true });
  const results = await h.drain();
  expect(results.length).toBeGreaterThan(0);
  const mail = h.mails.findLast((m) => m.to === data.email);
  expect(mail).toBeDefined();
  return linkIn(mail!, "/apply/verify").searchParams.get("token")!;
}

async function expectServiceError(promise: Promise<unknown>, code: ServiceError["code"]) {
  await expect(promise).rejects.toBeInstanceOf(ServiceError);
  await expect(promise).rejects.toMatchObject({ code });
}

async function approvedShop() {
  const root = await superadmin();
  const token = await submitAndGetToken();
  await verifyApplicationEmail(token, nextIp());
  const [app] = await listApplications(root, "PENDING");
  const res = await approveApplication(root, app.id);
  await h.drain();
  return { root, app, ...res };
}

function ownerCtx(tenantId: string, ownerId: string, email: string): ServiceContext {
  return { tenantId, actor: { id: ownerId, role: "OWNER", tenantId, email } };
}

describe("dealer sign-up", () => {
  it("stores the application with checks and mails a verification link (platform host)", async () => {
    const token = await submitAndGetToken();
    const app = await db.dealerApplication.findFirstOrThrow();
    expect(app).toMatchObject({ status: "PENDING", email: "jan@vries.example", country: "NL", legalConsent: true, emailVerifiedAt: null });
    expect(app.checks).toMatchObject({ emailVerified: false, cocFormat: "ok", duplicateEmail: false, duplicateShopName: false, disposableEmail: false });
    expect(token.startsWith(`${app.id}.`)).toBe(true);
    const link = linkIn(h.mails[0], "/apply/verify");
    expect(link.host).toBe("platform.test");
  });

  it("validates input", async () => {
    const res = await submit({ ...application, email: "bad", legalConsent: false });
    expect(res).toMatchObject({ ok: false, error: "invalid" });
    if (!res.ok && res.error === "invalid") expect(Object.keys(res.fieldErrors).sort()).toEqual(["email", "legalConsent"]);
    expect(await db.dealerApplication.count()).toBe(0);
  });

  it("does not duplicate a pending application for the same email (re-sends the link)", async () => {
    await submitAndGetToken();
    await submitAndGetToken({ ...application, shopName: "Another name" });
    expect(await db.dealerApplication.count()).toBe(1);
    expect(h.mails.filter((m) => m.to === application.email)).toHaveLength(2);
  });

  it("flags duplicates, disposable domains and bad CoC numbers", async () => {
    const ctx = await createTenantContext();
    await db.tenant.update({ where: { id: ctx.tenantId }, data: { name: "Vries Militaria B.V." } });
    await submit({ ...application, email: "x@mailinator.com", cocNumber: "123" });
    const app = await db.dealerApplication.findFirstOrThrow();
    expect(app.checks).toMatchObject({ duplicateShopName: true, disposableEmail: true, cocFormat: "invalid" });
  });

  it("rate limits per email atomically (3 per day)", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => submitApplication({ data: { ...application, shopName: `Shop ${i}` }, ip: `10.1.0.${i}`, turnstileToken: null })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok && r.error === "rate_limited")).toHaveLength(2);
  });

  it("verifies the email once and notifies every active superadmin", async () => {
    const a = await superadmin();
    await superadmin();
    await db.user.update({ where: { id: a.actor.id }, data: { disabledAt: new Date() } });
    const token = await submitAndGetToken();
    h.mails.length = 0;
    expect(await verifyApplicationEmail(token, nextIp())).toBe("verified");
    expect(await verifyApplicationEmail(token, nextIp())).toBe("already_verified");
    expect(await verifyApplicationEmail(token.slice(0, -3) + "abc", nextIp())).toBe("invalid");
    await h.drain();
    expect(h.mails).toHaveLength(1);
    expect(h.mails[0].subject).toContain("New dealer application");
    const app = await db.dealerApplication.findFirstOrThrow();
    expect(app.emailVerifiedAt).not.toBeNull();
    expect(app.checks).toMatchObject({ emailVerified: true });
  });
});

describe("superadmin review", () => {
  it("approves atomically: tenant, settings, sub-domain, owner, invite, link", async () => {
    const { app, tenant, domain, owner, inviteToken } = await approvedShop();
    expect(tenant).toMatchObject({ slug: "vries-militaria", name: "Vries Militaria", status: "ACTIVE", setupCompletedAt: null });
    expect(tenant.setupState).toEqual({});
    expect(domain).toMatchObject({ host: "vries-militaria.shops.test", isPrimary: true });
    const general = await getSettings(tenant.id, "general");
    expect(general).toMatchObject({ shopName: "Vries Militaria", contactEmail: "jan@vries.example", cocNumber: "12345678" });
    expect(general.address.country).toBe("NL");
    const user = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(user).toMatchObject({ role: "OWNER", tenantId: tenant.id, passwordHash: null });
    expect(user.emailVerifiedAt).not.toBeNull();
    const tokens = await db.authToken.findMany({ where: { userId: owner.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe("INVITE");
    const ttl = tokens[0].expiresAt.getTime() - tokens[0].createdAt.getTime();
    expect(Math.abs(ttl - 24 * 3600 * 1000)).toBeLessThan(5000);
    expect(await db.dealerApplication.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "APPROVED", tenantId: tenant.id });
    // Draft system pages exist (legal pages come from the wizard).
    expect(await db.contentPage.count({ where: { tenantId: tenant.id, systemKey: "HOME" } })).toBe(1);

    const invite = h.mails.find((m) => m.to === "jan@vries.example" && String(m.subject).includes("approved"));
    expect(invite).toBeDefined();
    const link = linkIn(invite!, "/admin/accept-invite");
    expect(link.host).toBe("vries-militaria.shops.test");
    expect(link.searchParams.get("token")).toBe(inviteToken);
  });

  it("refuses a second approval and approval after rejection", async () => {
    const { root, app } = await approvedShop();
    await expectServiceError(approveApplication(root, app.id), "CONFLICT");
    await expectServiceError(rejectApplication(root, app.id, "Too late"), "CONFLICT");
    expect(await db.tenant.count()).toBe(1);
  });

  it("picks a free slug when the shop name is taken", async () => {
    await db.tenant.create({ data: { slug: "vries-militaria", name: "Old" } });
    const { tenant, domain } = await approvedShop();
    expect(tenant.slug).toBe("vries-militaria-2");
    expect(domain.host).toBe("vries-militaria-2.shops.test");
  });

  it("skips a sub-domain host that another shop already uses", async () => {
    const root = await superadmin();
    await submitAndGetToken();
    const [app] = await listApplications(root, "PENDING");
    // Another tenant already owns the host the approval would create (slug free, host taken).
    const other = await db.tenant.create({ data: { slug: "other", name: "Other" } });
    await db.tenantDomain.create({ data: { tenantId: other.id, host: "vries-militaria.shops.test", isPrimary: true } });
    const res = await approveApplication(root, app.id);
    expect(res.domain.host).toBe("vries-militaria-2.shops.test"); // the clash is detected up front
  });

  it("rejects with a reason mailed to the applicant", async () => {
    const root = await superadmin();
    await submitAndGetToken();
    const [app] = await listApplications(root, "PENDING");
    await expectServiceError(rejectApplication(root, app.id, ""), "INVALID");
    await rejectApplication(root, app.id, "We cannot verify your business.");
    await h.drain();
    const mail = h.mails.find((m) => m.subject === "Your Quartermaster application");
    expect(String(mail?.html)).toContain("We cannot verify your business.");
    expect(await db.dealerApplication.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "REJECTED", reviewedById: root.actor.id });
    await expectServiceError(approveApplication(root, app.id), "CONFLICT");
    expect(await db.tenant.count()).toBe(0);
  });

  it("only a SUPERADMIN may review", async () => {
    await submitAndGetToken();
    const app = await db.dealerApplication.findFirstOrThrow();
    const owner = await createTenantContext();
    const fake = { actor: { ...owner.actor } } as PlatformContext;
    await expect(approveApplication(fake, app.id)).rejects.toBeInstanceOf(AuthError);
    await expect(rejectApplication(fake, app.id, "nope")).rejects.toBeInstanceOf(AuthError);
    await expect(listApplications(fake)).rejects.toBeInstanceOf(AuthError);
    expect((await db.dealerApplication.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("PENDING");
  });
});

describe("owner invite", () => {
  it("is accepted only on the shop's host, once, and signs the owner in", async () => {
    const { tenant, owner, inviteToken } = await approvedShop();
    const other = await createTenantContext();
    expect(await acceptDealerInvite(inviteToken, "a-long-password-123", { tenantId: other.tenantId })).toEqual({ ok: false, error: "invalid_token" });
    expect(await acceptDealerInvite(inviteToken, "short", { tenantId: tenant.id })).toMatchObject({ ok: false, error: "invalid_password" });

    expect(await acceptDealerInvite(inviteToken, "a-long-password-123", { tenantId: tenant.id })).toEqual({ ok: true, userId: owner.id });
    const user = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(await verifyPassword("a-long-password-123", user.passwordHash!)).toBe(true);
    expect(await db.session.count({ where: { userId: owner.id } })).toBe(1);
    expect(await acceptDealerInvite(inviteToken, "another-long-password", { tenantId: tenant.id })).toEqual({ ok: false, error: "invalid_token" });
  });

  it("can be re-sent; the old link stops working", async () => {
    const { root, app, tenant, inviteToken } = await approvedShop();
    h.mails.length = 0;
    const fresh = await resendDealerInvite(root, app.id);
    await h.drain();
    expect(h.mails).toHaveLength(1);
    expect(await acceptDealerInvite(inviteToken, "a-long-password-123", { tenantId: tenant.id })).toMatchObject({ ok: false });
    expect(await acceptDealerInvite(fresh.token, "a-long-password-123", { tenantId: tenant.id })).toMatchObject({ ok: true });
    await expectServiceError(resendDealerInvite(root, app.id), "INVALID"); // accepted already
  });

  it("expires after 24 hours", async () => {
    const { tenant, owner, inviteToken } = await approvedShop();
    await db.authToken.updateMany({ where: { userId: owner.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await acceptDealerInvite(inviteToken, "a-long-password-123", { tenantId: tenant.id })).toEqual({ ok: false, error: "invalid_token" });
  });
});

describe("setup wizard", () => {
  it("persists step progress and saves through the existing services", async () => {
    const { tenant, owner } = await approvedShop();
    const ctx = ownerCtx(tenant.id, owner.id, owner.email);
    expect(await getPendingSetup(ctx)).not.toBeNull();

    await saveBasicsStep(ctx, { shopName: "Vries Militaria NL", contactEmail: "shop@vries.example", displayCurrencies: ["USD", "EUR"] });
    const general = await getSettings(tenant.id, "general");
    expect(general).toMatchObject({ shopName: "Vries Militaria NL", contactEmail: "shop@vries.example", displayCurrencies: ["USD"] });

    await expect(saveBusinessStep(ctx, { cocNumber: "", line1: "", postalCode: "", city: "", country: "NL" })).rejects.toBeInstanceOf(ServiceError);
    await saveBusinessStep(ctx, { cocNumber: "12345678", vatNumber: "nl 1234.56789.b01", iban: "NL91 ABNA 0417 1643 00", line1: "Dorpsstraat 1", postalCode: "1234 AB", city: "Utrecht", country: "NL" });
    expect((await getSettings(tenant.id, "general")).vatNumber).toBe("NL123456789B01");

    await markSetupStep(ctx, "look", "skipped");
    const state = (await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).setupState as Record<string, { done: boolean; skipped?: boolean }>;
    expect(state.basics.done).toBe(true);
    expect(state.business.done).toBe(true);
    expect(state.look).toMatchObject({ done: false, skipped: true });

    await applyShippingTemplate(ctx, "worldwide");
    const zones = await db.shippingZone.findMany({ where: { tenantId: tenant.id }, include: { rates: true } });
    expect(zones.map((z) => z.name).sort()).toEqual(["Belgium & Luxembourg", "European Union", "Netherlands", "Rest of world"]);
    expect(zones.every((z) => z.rates.length === 3)).toBe(true);
    await expectServiceError(applyShippingTemplate(ctx, "domestic"), "CONFLICT");

    await createLegalPages(ctx, ["terms", "privacy", "returns", "shipping"]);
    const pages = await db.contentPage.findMany({ where: { tenantId: tenant.id, slug: { in: ["terms", "privacy", "returns", "shipping"] } }, include: { blocks: true } });
    expect(pages).toHaveLength(4);
    expect(pages.every((p) => p.publishedAt !== null && p.blocks.length === 1)).toBe(true);
    expect(JSON.stringify(pages.find((p) => p.slug === "terms")!.blocks[0].data)).toContain("Vries Militaria NL");
  });

  it("goes live only when required points pass and warnings are acknowledged", async () => {
    const { tenant, owner } = await approvedShop();
    const ctx = ownerCtx(tenant.id, owner.id, owner.email);
    await expectServiceError(completeSetup(ctx, { acknowledgeWarnings: true }), "INVALID");

    await saveBusinessStep(ctx, { cocNumber: "12345678", line1: "Dorpsstraat 1", postalCode: "1234 AB", city: "Utrecht", country: "NL" });
    await applyShippingTemplate(ctx, "domestic");
    await createLegalPages(ctx, ["terms", "privacy"]);
    const checklist = await getGoLiveChecklist(ctx);
    expect(checklist.filter((i) => i.required).every((i) => i.ok)).toBe(true);
    expect(checklist.find((i) => i.key === "payments")?.ok).toBe(false);

    await expectServiceError(completeSetup(ctx, { acknowledgeWarnings: false }), "INVALID");
    await completeSetup(ctx, { acknowledgeWarnings: true });
    const after = await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(after.setupCompletedAt).not.toBeNull();
    expect(await getPendingSetup(ctx)).toBeNull();
    await expectServiceError(markSetupStep(ctx, "look", "done"), "INVALID");
  });

  it("records an own-domain request and notifies the platform team", async () => {
    await superadmin();
    const { tenant, owner } = await approvedShop();
    const ctx = ownerCtx(tenant.id, owner.id, owner.email);
    h.mails.length = 0;
    await expectServiceError(requestOwnDomain(ctx, "other.shops.test"), "INVALID");
    expect(await requestOwnDomain(ctx, "https://WWW.Vries-Militaria.nl/")).toBe("www.vries-militaria.nl");
    await h.drain();
    expect(h.mails.some((m) => String(m.subject).startsWith("Own domain requested"))).toBe(true);
    const state = (await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).setupState as Record<string, { domainRequest?: string }>;
    expect(state.golive.domainRequest).toBe("www.vries-militaria.nl");
    expect(await db.tenantDomain.count({ where: { tenantId: tenant.id } })).toBe(1); // never added automatically
  });

  it("is only for that tenant's OWNER; existing shops never see it", async () => {
    const { tenant, owner } = await approvedShop();
    const otherOwner = await createTenantContext();
    const sneaky: ServiceContext = { tenantId: tenant.id, actor: otherOwner.actor };
    await expect(markSetupStep(sneaky, "basics", "done")).rejects.toBeInstanceOf(AuthError);
    await expect(saveBasicsStep(sneaky, { shopName: "Hacked", contactEmail: "x@y.z" })).rejects.toBeInstanceOf(AuthError);
    expect(await getPendingSetup(sneaky)).toBeNull();

    const root = await superadmin();
    const asRoot: ServiceContext = { tenantId: tenant.id, actor: root.actor };
    await expect(markSetupStep(asRoot, "basics", "done")).rejects.toBeInstanceOf(AuthError);
    expect(await getPendingSetup(asRoot)).toBeNull();

    // A shop that predates the wizard (setupState null).
    expect(await getPendingSetup(otherOwner)).toBeNull();
    expect(await getPendingSetup(ownerCtx(tenant.id, owner.id, owner.email))).not.toBeNull();
  });
});
