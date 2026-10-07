import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { getSettings } from "@/server/settings";
import { ServiceError, type ServiceContext } from "@/server/context";
import { encrypt } from "@/server/auth/encryption";
import { generateToken, hashToken } from "@/server/auth/tokens";
import * as rateLimit from "@/server/auth/rate-limit";
import type { Prisma } from "@/generated/prisma/client";
import { queueMail } from "@/server/mail/queue";
import { verifyUnsubscribe } from "./signing";

/*
 * Subscriber lifecycle (status is derived, see prisma/schema.prisma):
 *   subscribe → PENDING (confirmTokenHash set, confirmation mail queued)
 *   confirm   → ACTIVE  (confirmedAt = consent timestamp, token cleared, unsubscribedAt cleared)
 *   unsubscribe → UNSUBSCRIBED (unsubscribedAt set). Re-subscribing needs a new confirmation.
 */

export const CONFIRM_TOKEN_TTL_DAYS = 7;
const CONFIRM_TTL_MS = CONFIRM_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
/** Per (tenant, email): at most 3 confirmation mails per hour, so the form can't be used to mail-bomb. */
const SUBSCRIBE_RULE = { limit: 3, windowMs: 60 * 60 * 1000 };

export type SubscriberStatus = "active" | "pending" | "unsubscribed";

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const sourceSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_-]{1,30}$/)
  .optional();

export function subscriberStatus(s: { confirmedAt: Date | null; unsubscribedAt: Date | null }): SubscriberStatus {
  if (s.unsubscribedAt) return "unsubscribed";
  return s.confirmedAt ? "active" : "pending";
}

export function statusWhere(status: SubscriberStatus | "all"): Prisma.NewsletterSubscriberWhereInput {
  switch (status) {
    case "active":
      return { confirmedAt: { not: null }, unsubscribedAt: null };
    case "pending":
      return { confirmedAt: null, unsubscribedAt: null };
    case "unsubscribed":
      return { unsubscribedAt: { not: null } };
    default:
      return {};
  }
}

export async function assertNewsletterEnabled(tenantId: string) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
  if (!tenant || tenant.status !== "ACTIVE") throw new ServiceError("NOT_FOUND", "Shop not found");
  const platform = await getSettings(tenantId, "platform");
  if (!platform.newsletterEnabled) throw new ServiceError("UNAVAILABLE", "The newsletter is not enabled for this shop");
  return platform;
}

// ─── Public (storefront) ────────────────────────────────────────────────────

export type SubscribeResult =
  | { status: "pending"; subscriberId: string }
  | { status: "already_subscribed" }
  | { status: "rate_limited" };

/**
 * Double opt-in sign-up. Callers (forms) must show the same neutral message for every outcome
 * ("check your inbox"), so the response never reveals whether an address is subscribed.
 * Bot protection (Turnstile or similar) belongs in the calling form/action.
 */
export async function subscribe(
  tenantId: string,
  email: string,
  opts: { source?: string; customerId?: string | null } = {},
): Promise<SubscribeResult> {
  const parsed = z.object({ email: emailSchema, source: sourceSchema }).safeParse({ email, source: opts.source });
  if (!parsed.success) throw new ServiceError("INVALID", "Enter a valid email address", parsed.error.issues);
  const { email: address, source } = parsed.data;
  await assertNewsletterEnabled(tenantId);

  const existing = await db.newsletterSubscriber.findUnique({ where: { tenantId_email: { tenantId, email: address } } });
  if (existing && subscriberStatus(existing) === "active") return { status: "already_subscribed" };

  const limitKey = `newsletter.subscribe:${tenantId}:${address}`;
  if (await rateLimit.isLimited(limitKey, SUBSCRIBE_RULE)) return { status: "rate_limited" };
  await rateLimit.hit(limitKey);

  // Link to the shop's customer record with the same email (or the given one, if it is in this tenant).
  const customer = await db.customer.findFirst({
    where: opts.customerId ? { id: opts.customerId, tenantId } : { tenantId, email: address },
    select: { id: true },
  });

  const token = generateToken();
  const now = new Date();
  const subscriber = await db.$transaction(async (tx) => {
    const row = await tx.newsletterSubscriber.upsert({
      where: { tenantId_email: { tenantId, email: address } },
      create: {
        tenantId,
        email: address,
        source: source ?? null,
        customerId: customer?.id ?? null,
        confirmTokenHash: hashToken(token),
        confirmSentAt: now,
      },
      update: {
        confirmTokenHash: hashToken(token),
        confirmSentAt: now,
        confirmedAt: null, // re-subscribing after an unsubscribe needs fresh consent
        ...(existing?.customerId ? {} : { customerId: customer?.id ?? null }),
        ...(existing?.source ? {} : { source: source ?? null }),
      },
    });
    await queueMail(
      { tenantId, template: "newsletter-confirm", props: { subscriberId: row.id, tokenEnc: encrypt(token) } },
      { tx },
    );
    return row;
  });
  return { status: "pending", subscriberId: subscriber.id };
}

export type ConfirmResult =
  | { ok: true; tenantId: string; subscriberId: string }
  | { ok: false; error: "invalid" | "expired"; tenantId?: string };

/**
 * Confirms a double-opt-in token. `opts.tenantId` (the tenant serving the request host, if any)
 * makes tokens of other shops invalid on this host.
 */
export async function confirmSubscription(token: string, opts: { tenantId?: string | null } = {}): Promise<ConfirmResult> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return { ok: false, error: "invalid" };
  const tokenHash = hashToken(token);
  const row = await db.newsletterSubscriber.findUnique({ where: { confirmTokenHash: tokenHash } });
  if (!row || (opts.tenantId && row.tenantId !== opts.tenantId)) return { ok: false, error: "invalid" };
  if (!row.confirmSentAt || row.confirmSentAt.getTime() + CONFIRM_TTL_MS < Date.now()) {
    return { ok: false, error: "expired", tenantId: row.tenantId };
  }
  const res = await db.newsletterSubscriber.updateMany({
    where: { id: row.id, confirmTokenHash: tokenHash },
    data: { confirmedAt: new Date(), unsubscribedAt: null, confirmTokenHash: null },
  });
  if (res.count === 0) return { ok: false, error: "invalid" };
  await audit({ action: "newsletter.confirmed", tenantId: row.tenantId, entity: "NewsletterSubscriber", entityId: row.id });
  return { ok: true, tenantId: row.tenantId, subscriberId: row.id };
}

export type UnsubscribeResult = { ok: true; tenantId: string; changed: boolean } | { ok: false; error: "invalid" };

/** Unsubscribe via a signed link (no login). Idempotent; a deleted subscriber counts as done. */
export async function unsubscribeSigned(input: { tenantId: string; subscriberId: string; sig: string }): Promise<UnsubscribeResult> {
  const { tenantId, subscriberId, sig } = input;
  if (!verifyUnsubscribe(tenantId, subscriberId, sig)) return { ok: false, error: "invalid" };
  const res = await db.newsletterSubscriber.updateMany({
    where: { id: subscriberId, tenantId, unsubscribedAt: null },
    data: { unsubscribedAt: new Date(), confirmTokenHash: null },
  });
  if (res.count > 0) {
    await audit({ action: "newsletter.unsubscribed", tenantId, entity: "NewsletterSubscriber", entityId: subscriberId });
  }
  return { ok: true, tenantId, changed: res.count > 0 };
}

// ─── Admin ──────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  status: z.enum(["active", "pending", "unsubscribed", "all"]).default("active"),
  search: z.string().trim().max(254).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type SubscriberListQuery = z.input<typeof listQuerySchema>;

export type SubscriberRow = {
  id: string;
  email: string;
  status: SubscriberStatus;
  source: string | null;
  customerId: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  unsubscribedAt: Date | null;
};

function toRow(s: {
  id: string;
  email: string;
  source: string | null;
  customerId: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  unsubscribedAt: Date | null;
}): SubscriberRow {
  return { ...s, status: subscriberStatus(s) };
}

function listWhere(ctx: ServiceContext, q: z.output<typeof listQuerySchema>): Prisma.NewsletterSubscriberWhereInput {
  return {
    tenantId: ctx.tenantId,
    ...statusWhere(q.status),
    ...(q.search ? { email: { contains: q.search.toLowerCase() } } : {}),
  };
}

const rowSelect = {
  id: true,
  email: true,
  source: true,
  customerId: true,
  createdAt: true,
  confirmedAt: true,
  unsubscribedAt: true,
} as const;

export async function listSubscribers(ctx: ServiceContext, query: SubscriberListQuery = {}) {
  const q = listQuerySchema.parse(query);
  const where = listWhere(ctx, q);
  const [total, rows] = await Promise.all([
    db.newsletterSubscriber.count({ where }),
    db.newsletterSubscriber.findMany({
      where,
      select: rowSelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return { items: rows.map(toRow), total, page: q.page, pageSize: q.pageSize };
}

export async function subscriberCounts(ctx: ServiceContext) {
  const count = (status: SubscriberStatus) =>
    db.newsletterSubscriber.count({ where: { tenantId: ctx.tenantId, ...statusWhere(status) } });
  const [active, pending, unsubscribed] = await Promise.all([count("active"), count("pending"), count("unsubscribed")]);
  return { active, pending, unsubscribed, total: active + pending + unsubscribed };
}

/** Neutralizes spreadsheet formulas (CSV injection) and quotes the cell. */
export function csvCell(value: string | null | undefined): string {
  let s = value ?? "";
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s !== (value ?? "") ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV export (all matching rows, no paging). Audited, since it is a bulk export of personal data. */
export async function exportSubscribersCsv(ctx: ServiceContext, query: Pick<SubscriberListQuery, "status" | "search"> = {}) {
  const q = listQuerySchema.parse({ ...query, page: 1 });
  const rows = await db.newsletterSubscriber.findMany({
    where: listWhere(ctx, q),
    select: rowSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const iso = (d: Date | null) => (d ? d.toISOString() : "");
  const lines = [
    "email,status,source,subscribed_at,confirmed_at,unsubscribed_at",
    ...rows.map(toRow).map((r) =>
      [csvCell(r.email), r.status, csvCell(r.source), iso(r.createdAt), iso(r.confirmedAt), iso(r.unsubscribedAt)].join(","),
    ),
  ];
  await audit({
    action: "newsletter.subscribers.exported",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    data: { status: q.status, count: rows.length },
  });
  return lines.join("\r\n") + "\r\n";
}

/** Hard delete (AVG erasure request / legacy bulk delete). */
export async function deleteSubscribers(ctx: ServiceContext, ids: string[]): Promise<number> {
  const parsed = z.array(z.string().min(1).max(64)).min(1).max(1000).parse(ids);
  const res = await db.newsletterSubscriber.deleteMany({ where: { tenantId: ctx.tenantId, id: { in: parsed } } });
  if (res.count) {
    await audit({
      action: "newsletter.subscribers.deleted",
      tenantId: ctx.tenantId,
      actorId: ctx.actor.id,
      entity: "NewsletterSubscriber",
      data: { count: res.count },
    });
  }
  return res.count;
}
