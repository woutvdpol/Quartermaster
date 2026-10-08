import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { encrypt } from "@/server/auth/encryption";
import { take, type RateLimitRule } from "@/server/auth/rate-limit";
import { ServiceError } from "@/server/context";
import { isUniqueViolation, parseInput } from "@/server/catalog/errors";
import { ensureSystemPages } from "@/server/content/pages";
import { queueMail } from "@/server/mail/queue";
import { assertPlatformActor, type PlatformContext } from "@/server/platform/context";
import { SETTINGS_GROUPS, defaultSettings, type SettingsGroup } from "@/server/settings/schema";
import { verifyTurnstile } from "@/server/turnstile";
import type { Prisma } from "@/generated/prisma/client";
import type { DealerApplicationStatus } from "@/generated/prisma/enums";
import { issueDealerInvite } from "./invite";
import {
  applicationSchema,
  baseTenantSlug,
  checkCocFormat,
  defaultTimeZone,
  isDisposableEmail,
  nextFreeTenantSlug,
  parseChecks,
  shopNameKey,
  shopSubdomainHost,
  type ApplicationChecks,
  type ApplicationField,
} from "./rules";
import { signApplicationToken, verifyApplicationToken } from "./verify-token";

/*
 * Dealer applications: public sign-up on the platform host → e-mail verification → SUPERADMIN review.
 *
 * - Submit: honeypot (in the action), zod validation, atomic rate limits per IP and per e-mail
 *   (`take`), Turnstile, then duplicate detection: a PENDING application with the same e-mail is not
 *   duplicated (its verification mail is re-sent instead). Automated checks are stored in `checks`.
 * - Verify: stateless HMAC link (./verify-token) → emailVerifiedAt + checks refresh + one notice mail
 *   per SUPERADMIN (only verified applications ping the platform team).
 * - Approve (one transaction): claim the application, create Tenant (+ setupState {} = wizard pending),
 *   default settings, primary TenantDomain `<slug>.<SHOP_SUBDOMAIN_BASE>`, OWNER without password,
 *   INVITE token (24 h) and the invite mail job; link application.tenantId. System pages afterwards.
 * - Reject: reason is mailed to the applicant. Everything is audited (platform log, tenantId null;
 *   the tenant creation is also logged on the new tenant).
 */

const HOUR = 60 * 60 * 1000;
export const APPLICATION_RULES = {
  submitPerIp: { limit: 10, windowMs: HOUR },
  submitPerEmail: { limit: 3, windowMs: 24 * HOUR },
  verifyPerIp: { limit: 30, windowMs: HOUR },
} satisfies Record<string, RateLimitRule>;

const idSchema = z.string().trim().min(1).max(64);

// ─── Checks ─────────────────────────────────────────────────────────────────

/** Computes the automated checks for an application (`excludeId` = the application itself). */
export async function computeChecks(
  data: { email: string; shopName: string; country: string; cocNumber: string | null },
  opts: { excludeId?: string; emailVerified?: boolean } = {},
): Promise<ApplicationChecks> {
  const notSelf = opts.excludeId ? { id: { not: opts.excludeId } } : {};
  const [otherApp, owner] = await Promise.all([
    db.dealerApplication.findFirst({ where: { email: data.email, ...notSelf }, select: { id: true } }),
    db.user.findFirst({ where: { email: data.email, role: { in: ["OWNER", "SUPERADMIN"] } }, select: { id: true } }),
  ]);

  // Shop names: compare normalized keys against existing shops and open/approved applications.
  const key = shopNameKey(data.shopName);
  let duplicateShopName = false;
  if (key) {
    const [tenants, apps] = await Promise.all([
      db.tenant.findMany({ select: { name: true, slug: true }, take: 5000 }),
      db.dealerApplication.findMany({ where: { status: { not: "REJECTED" }, ...notSelf }, select: { shopName: true }, take: 5000 }),
    ]);
    duplicateShopName =
      tenants.some((t) => shopNameKey(t.name) === key || shopNameKey(t.slug) === key) || apps.some((a) => shopNameKey(a.shopName) === key);
  }

  return {
    emailVerified: opts.emailVerified ?? false,
    cocFormat: checkCocFormat(data.country, data.cocNumber),
    duplicateEmail: Boolean(otherApp || owner),
    duplicateShopName,
    disposableEmail: isDisposableEmail(data.email),
    checkedAt: new Date().toISOString(),
  };
}

// ─── Public: submit + verify ────────────────────────────────────────────────

export type SubmitApplicationResult =
  | { ok: true }
  | { ok: false; error: "invalid"; fieldErrors: Partial<Record<ApplicationField, string>> }
  | { ok: false; error: "rate_limited" | "captcha" };

async function queueVerification(applicationId: string, tx?: Prisma.TransactionClient) {
  const token = signApplicationToken(applicationId);
  await queueMail(
    { tenantId: null, template: "dealer-application-verify", props: { applicationId, tokenEnc: encrypt(token) } },
    tx ? { tx } : {},
  );
}

export async function submitApplication(input: { data: unknown; ip: string | null; turnstileToken: string | null }): Promise<SubmitApplicationResult> {
  const parsed = applicationSchema.safeParse(input.data);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<ApplicationField, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as ApplicationField | undefined;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: "invalid", fieldErrors };
  }
  const data = parsed.data;

  // Atomic limits: N parallel submissions can never all pass.
  if (!(await take(`apply:ip:${input.ip ?? "unknown"}`, APPLICATION_RULES.submitPerIp))) return { ok: false, error: "rate_limited" };
  if (!(await take(`apply:email:${data.email}`, APPLICATION_RULES.submitPerEmail))) return { ok: false, error: "rate_limited" };

  const captcha = await verifyTurnstile(input.turnstileToken, input.ip, { action: "apply" });
  if (!captcha.ok) return { ok: false, error: "captcha" };

  // Duplicate: an open application for this e-mail → don't create another, re-send its verification.
  const existing = await db.dealerApplication.findFirst({
    where: { email: data.email, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    select: { id: true, emailVerifiedAt: true },
  });
  if (existing) {
    if (!existing.emailVerifiedAt) await queueVerification(existing.id);
    await audit({ action: "dealer_application.resubmitted", entity: "DealerApplication", entityId: existing.id });
    return { ok: true };
  }

  const checks = await computeChecks(data);
  const app = await db.$transaction(async (tx) => {
    const created = await tx.dealerApplication.create({
      data: {
        applicantName: data.applicantName,
        email: data.email,
        shopName: data.shopName,
        country: data.country,
        cocNumber: data.cocNumber,
        currentPlatform: data.currentPlatform,
        description: data.description,
        legalConsent: data.legalConsent,
        checks: checks as unknown as Prisma.InputJsonValue,
        ip: input.ip,
      },
    });
    await queueVerification(created.id, tx);
    return created;
  });
  await audit({ action: "dealer_application.submitted", entity: "DealerApplication", entityId: app.id, data: { shopName: app.shopName, country: app.country } });
  return { ok: true };
}

/** Notifies every active SUPERADMIN (one mail job each). */
export async function notifySuperadmins(props: { kind: "application" | "migration" | "domain"; applicationId?: string; tenantId?: string; detail?: string }) {
  const admins = await db.user.findMany({ where: { role: "SUPERADMIN", tenantId: null, disabledAt: null }, select: { email: true } });
  for (const a of admins) {
    if (/\.invalid$/i.test(a.email)) continue;
    await queueMail({ tenantId: null, template: "platform-admin-notice", props, to: a.email });
  }
}

export type VerifyApplicationResult = "verified" | "already_verified" | "invalid" | "rate_limited";

/** Confirms the applicant's e-mail (POST from /apply/verify). Idempotent. */
export async function verifyApplicationEmail(token: unknown, ip: string | null): Promise<VerifyApplicationResult> {
  if (!(await take(`apply-verify:ip:${ip ?? "unknown"}`, APPLICATION_RULES.verifyPerIp))) return "rate_limited";
  const id = verifyApplicationToken(token);
  if (!id) return "invalid";
  const app = await db.dealerApplication.findUnique({ where: { id } });
  if (!app || app.status === "REJECTED") return "invalid";
  if (app.emailVerifiedAt) return "already_verified";

  const checks = await computeChecks(app, { excludeId: app.id, emailVerified: true });
  const { count } = await db.dealerApplication.updateMany({
    where: { id, emailVerifiedAt: null },
    data: { emailVerifiedAt: new Date(), checks: checks as unknown as Prisma.InputJsonValue },
  });
  if (count === 0) return "already_verified";
  await audit({ action: "dealer_application.email_verified", entity: "DealerApplication", entityId: id });
  if (app.status === "PENDING") await notifySuperadmins({ kind: "application", applicationId: id });
  return "verified";
}

// ─── Platform admin (SUPERADMIN) ────────────────────────────────────────────

export type ApplicationListItem = {
  id: string;
  status: DealerApplicationStatus;
  shopName: string;
  email: string;
  applicantName: string;
  country: string;
  currentPlatform: string | null;
  checks: ApplicationChecks | null;
  emailVerified: boolean;
  createdAt: Date;
};

const statusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);

export async function listApplications(ctx: PlatformContext, status: DealerApplicationStatus = "PENDING"): Promise<ApplicationListItem[]> {
  assertPlatformActor(ctx);
  const rows = await db.dealerApplication.findMany({
    where: { status: parseInput(statusSchema, status) },
    orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
    take: 500,
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    shopName: r.shopName,
    email: r.email,
    applicantName: r.applicantName,
    country: r.country,
    currentPlatform: r.currentPlatform,
    checks: parseChecks(r.checks),
    emailVerified: r.emailVerifiedAt !== null,
    createdAt: r.createdAt,
  }));
}

export async function countApplications(ctx: PlatformContext): Promise<Record<DealerApplicationStatus, number>> {
  assertPlatformActor(ctx);
  const groups = await db.dealerApplication.groupBy({ by: ["status"], _count: { _all: true } });
  const out: Record<DealerApplicationStatus, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const g of groups) out[g.status] = g._count._all;
  return out;
}

export async function getApplication(ctx: PlatformContext, id: string) {
  assertPlatformActor(ctx);
  const app = await db.dealerApplication.findUnique({
    where: { id: parseInput(idSchema, id) },
    include: { tenant: { select: { id: true, name: true, slug: true, setupCompletedAt: true, domains: { where: { isPrimary: true }, select: { host: true } } } } },
  });
  if (!app) throw new ServiceError("NOT_FOUND", "Application not found");
  const [reviewer, owner] = await Promise.all([
    app.reviewedById ? db.user.findUnique({ where: { id: app.reviewedById }, select: { email: true } }) : null,
    app.tenantId
      ? db.user.findFirst({ where: { tenantId: app.tenantId, role: "OWNER", email: app.email }, select: { id: true, passwordHash: true, lastLoginAt: true } })
      : null,
  ]);
  return {
    ...app,
    checks: parseChecks(app.checks),
    reviewerEmail: reviewer?.email ?? null,
    owner: owner ? { id: owner.id, invitePending: owner.passwordHash === null, lastLoginAt: owner.lastLoginAt } : null,
    /** Address the shop gets (or got) on approval. */
    proposedHost: app.tenant?.domains[0]?.host ?? shopSubdomainHost(baseTenantSlug(app.shopName)),
  };
}
export type ApplicationDetail = Awaited<ReturnType<typeof getApplication>>;

export async function saveApplicationNote(ctx: PlatformContext, id: string, note: string) {
  assertPlatformActor(ctx);
  const appId = parseInput(idSchema, id);
  const text = parseInput(z.string().trim().max(5000), note ?? "");
  const updated = await db.dealerApplication.updateMany({ where: { id: appId }, data: { internalNote: text || null } });
  if (updated.count === 0) throw new ServiceError("NOT_FOUND", "Application not found");
  await audit({ action: "dealer_application.note_saved", actorId: ctx.actor.id, entity: "DealerApplication", entityId: appId });
}

export async function rejectApplication(ctx: PlatformContext, id: string, reason: string) {
  assertPlatformActor(ctx);
  const appId = parseInput(idSchema, id);
  const why = parseInput(z.string().trim().min(3, "Give a reason (it is sent to the applicant).").max(1000), reason ?? "");
  await db.$transaction(async (tx) => {
    const { count } = await tx.dealerApplication.updateMany({
      where: { id: appId, status: "PENDING" },
      data: { status: "REJECTED", rejectReason: why, reviewedById: ctx.actor.id, reviewedAt: new Date() },
    });
    if (count === 0) {
      const exists = await tx.dealerApplication.count({ where: { id: appId } });
      throw exists ? new ServiceError("CONFLICT", "This application has already been reviewed") : new ServiceError("NOT_FOUND", "Application not found");
    }
    await queueMail({ tenantId: null, template: "dealer-application-rejected", props: { applicationId: appId } }, { tx });
  });
  await audit({ action: "dealer_application.rejected", actorId: ctx.actor.id, entity: "DealerApplication", entityId: appId, data: { reason: why } });
}

/** Initial settings rows for an approved dealer: every group's defaults plus what the application told us. */
function initialSettings(app: { shopName: string; email: string; country: string; cocNumber: string | null }) {
  return SETTINGS_GROUPS.map((group: SettingsGroup) => {
    const data = defaultSettings(group) as Record<string, unknown>;
    if (group === "general") {
      data.shopName = app.shopName;
      data.contactEmail = app.email;
      data.address = { ...(data.address as object), country: app.country };
      if (app.cocNumber) data.cocNumber = app.cocNumber;
    }
    return { group, data: data as Prisma.InputJsonValue };
  });
}

/**
 * Approves a PENDING application. One transaction: claim, Tenant (setupState {} → wizard pending),
 * settings, TenantDomain on the platform sub-domain, OWNER (no password), INVITE token + mail job,
 * application.tenantId. Then (best effort) the shop's draft system pages.
 */
export async function approveApplication(ctx: PlatformContext, id: string) {
  assertPlatformActor(ctx);
  const appId = parseInput(idSchema, id);
  const app = await db.dealerApplication.findUnique({ where: { id: appId } });
  if (!app) throw new ServiceError("NOT_FOUND", "Application not found");
  if (app.status !== "PENDING") throw new ServiceError("CONFLICT", "This application has already been reviewed");

  const base = baseTenantSlug(app.shopName);
  let result;
  try {
    result = await db.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.dealerApplication.updateMany({
        where: { id: appId, status: "PENDING" },
        data: { status: "APPROVED", reviewedById: ctx.actor.id, reviewedAt: now },
      });
      if (claimed.count !== 1) throw new ServiceError("CONFLICT", "This application has already been reviewed");

      const [slugs, hosts] = await Promise.all([
        tx.tenant.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } }),
        tx.tenantDomain.findMany({ where: { host: { startsWith: `${base}` } }, select: { host: true } }),
      ]);
      const taken = [...slugs.map((s) => s.slug), ...hosts.map((h) => h.host.split(".")[0])];
      const slug = nextFreeTenantSlug(base, taken);
      const host = shopSubdomainHost(slug);

      const tenant = await tx.tenant.create({
        data: { slug, name: app.shopName, timezone: defaultTimeZone(app.country), setupState: {} },
      });
      const domain = await tx.tenantDomain.create({ data: { tenantId: tenant.id, host, isPrimary: true } });
      await tx.setting.createMany({ data: initialSettings(app).map((s) => ({ tenantId: tenant.id, ...s })) });
      const owner = await tx.user.create({
        data: { tenantId: tenant.id, role: "OWNER", email: app.email, name: app.applicantName, emailVerifiedAt: app.emailVerifiedAt },
        select: { id: true, email: true },
      });
      const invite = await issueDealerInvite(tx, { tenantId: tenant.id, userId: owner.id });
      await tx.dealerApplication.update({ where: { id: appId }, data: { tenantId: tenant.id } });
      return { tenant, domain, owner, invite };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError("CONFLICT", "The shop address was taken at the same moment; try again");
    throw err;
  }

  const { tenant, domain, owner, invite } = result;
  await audit({
    action: "dealer_application.approved",
    actorId: ctx.actor.id,
    entity: "DealerApplication",
    entityId: appId,
    data: { tenantId: tenant.id, slug: tenant.slug, host: domain.host },
  });
  await audit({
    action: "tenant.created",
    tenantId: tenant.id,
    actorId: ctx.actor.id,
    entity: "Tenant",
    entityId: tenant.id,
    data: { slug: tenant.slug, name: tenant.name, host: domain.host, ownerEmail: owner.email, applicationId: appId },
  });
  await audit({ action: "user.invited", tenantId: tenant.id, actorId: ctx.actor.id, entity: "User", entityId: owner.id, data: { email: owner.email } });
  try {
    await ensureSystemPages(tenant.id);
  } catch (err) {
    console.error(`[onboarding] ensureSystemPages failed for ${tenant.id}:`, err);
  }
  return { tenant, domain, owner, inviteToken: invite.token, inviteExpiresAt: invite.expiresAt };
}

/** New invite (24 h) for the owner of an approved application who has not chosen a password yet. */
export async function resendDealerInvite(ctx: PlatformContext, applicationId: string) {
  assertPlatformActor(ctx);
  const app = await db.dealerApplication.findUnique({ where: { id: parseInput(idSchema, applicationId) } });
  if (!app) throw new ServiceError("NOT_FOUND", "Application not found");
  if (app.status !== "APPROVED" || !app.tenantId) throw new ServiceError("INVALID", "Only approved applications have an invite");
  const owner = await db.user.findFirst({ where: { tenantId: app.tenantId, role: "OWNER", email: app.email } });
  if (!owner) throw new ServiceError("NOT_FOUND", "The owner account no longer exists");
  if (owner.passwordHash !== null) throw new ServiceError("INVALID", "The owner has already accepted the invite");
  if (owner.disabledAt) throw new ServiceError("INVALID", "The owner account is disabled");
  const tenantId = app.tenantId;
  const invite = await db.$transaction((tx) => issueDealerInvite(tx, { tenantId, userId: owner.id }));
  await audit({ action: "user.invite_resent", tenantId, actorId: ctx.actor.id, entity: "User", entityId: owner.id, data: { applicationId: app.id } });
  return invite;
}
