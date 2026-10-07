import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { getSettings } from "@/server/settings";
import { ServiceError, type ServiceContext } from "@/server/context";
import type { Prisma } from "@/generated/prisma/client";
import type { CampaignStatus } from "@/generated/prisma/enums";
import { enqueueMany } from "@/server/jobs/queue";
import { queueMail } from "@/server/mail/queue";
import { CAMPAIGN_BATCH_SIZE } from "./jobs";
import { renderMarkdown } from "./markdown";
import { checkQuota, monthWindow } from "./quota";
import { assertNewsletterEnabled, emailSchema, statusWhere } from "./subscribers";

const campaignInput = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Content is required").max(65_535),
});
export type CampaignInput = z.input<typeof campaignInput>;

export type CampaignRow = {
  id: string;
  subject: string;
  body: string;
  status: CampaignStatus;
  sentAt: Date | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: Date;
  updatedAt: Date;
};

const select = {
  id: true,
  subject: true,
  body: true,
  status: true,
  sentAt: true,
  recipientCount: true,
  sentCount: true,
  failedCount: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Sanitized HTML of a campaign body (safe for the admin preview's dangerouslySetInnerHTML too). */
export function campaignBodyHtml(markdown: string): string {
  return renderMarkdown(markdown);
}

async function findCampaign(ctx: ServiceContext, id: string) {
  const row = await db.newsletterCampaign.findFirst({ where: { id, tenantId: ctx.tenantId }, select });
  if (!row) throw new ServiceError("NOT_FOUND", "Campaign not found");
  return row;
}

export async function listCampaigns(ctx: ServiceContext): Promise<CampaignRow[]> {
  return db.newsletterCampaign.findMany({ where: { tenantId: ctx.tenantId }, select, orderBy: { createdAt: "desc" } });
}

export async function getCampaign(ctx: ServiceContext, id: string): Promise<CampaignRow & { bodyHtml: string }> {
  const row = await findCampaign(ctx, id);
  return { ...row, bodyHtml: campaignBodyHtml(row.body) };
}

export async function createCampaign(ctx: ServiceContext, input: CampaignInput): Promise<CampaignRow> {
  const data = campaignInput.parse(input);
  const row = await db.newsletterCampaign.create({
    data: { ...data, tenantId: ctx.tenantId, createdById: ctx.actor.id },
    select,
  });
  await audit({ action: "newsletter.campaign.created", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "NewsletterCampaign", entityId: row.id });
  return row;
}

/** Only drafts can be edited. */
export async function updateCampaign(ctx: ServiceContext, id: string, input: Partial<CampaignInput>): Promise<CampaignRow> {
  const data = campaignInput.partial().parse(input);
  const res = await db.newsletterCampaign.updateMany({ where: { id, tenantId: ctx.tenantId, status: "DRAFT" }, data });
  if (res.count === 0) {
    await findCampaign(ctx, id); // NOT_FOUND for foreign/missing ids
    throw new ServiceError("CONFLICT", "Only draft campaigns can be edited");
  }
  await audit({
    action: "newsletter.campaign.updated",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "NewsletterCampaign",
    entityId: id,
    data: { fields: Object.keys(data) },
  });
  return findCampaign(ctx, id);
}

/** Only drafts can be deleted; sent campaigns stay as history (and count towards the quota). */
export async function deleteCampaign(ctx: ServiceContext, id: string): Promise<void> {
  const res = await db.newsletterCampaign.deleteMany({ where: { id, tenantId: ctx.tenantId, status: "DRAFT" } });
  if (res.count === 0) {
    await findCampaign(ctx, id);
    throw new ServiceError("CONFLICT", "Only draft campaigns can be deleted");
  }
  await audit({ action: "newsletter.campaign.deleted", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "NewsletterCampaign", entityId: id });
}

// ─── Quota ──────────────────────────────────────────────────────────────────

async function usedThisMonth(client: Prisma.TransactionClient | typeof db, tenantId: string, timeZone: string, now = new Date()) {
  const window = monthWindow(now, timeZone);
  const agg = await client.newsletterCampaign.aggregate({
    where: { tenantId, sentAt: { gte: window.start, lt: window.end } },
    _sum: { recipientCount: true },
  });
  return { used: agg._sum.recipientCount ?? 0, window };
}

/** Quota overview for the admin (see quota.ts for how usage is counted). */
export async function getNewsletterQuota(ctx: ServiceContext) {
  const [platform, tenant] = await Promise.all([
    getSettings(ctx.tenantId, "platform"),
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { timezone: true } }),
  ]);
  const { used, window } = await usedThisMonth(db, ctx.tenantId, tenant.timezone);
  const quota = platform.newsletterQuota;
  return {
    enabled: platform.newsletterEnabled,
    quota,
    unlimited: quota === -1,
    used,
    remaining: quota === -1 ? null : Math.max(0, quota - used),
    periodStart: window.start,
    periodEnd: window.end,
  };
}

// ─── Sending ────────────────────────────────────────────────────────────────

/** Queues one copy of the campaign to `toEmail` ("[Test]" subject, dummy unsubscribe link). Doesn't count. */
export async function sendTestCampaign(ctx: ServiceContext, id: string, toEmail: string): Promise<void> {
  const to = emailSchema.safeParse(toEmail);
  if (!to.success) throw new ServiceError("INVALID", "Enter a valid email address");
  await assertNewsletterEnabled(ctx.tenantId);
  await findCampaign(ctx, id);
  await queueMail({ tenantId: ctx.tenantId, template: "newsletter-campaign-test", props: { campaignId: id }, to: to.data });
  await audit({
    action: "newsletter.campaign.test_sent",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "NewsletterCampaign",
    entityId: id,
    data: { to: to.data },
  });
}

export type SendCampaignResult = { recipientCount: number; batches: number };

/**
 * Starts sending a draft to every active subscriber: checks the monthly quota, freezes the recipient
 * list, marks the campaign SENDING and queues `newsletter.campaign.batch` jobs of 200 subscribers —
 * all in one transaction, so a campaign is either fully queued or not at all. Each batch job then
 * queues one `mail.send` per subscriber; the counters on the campaign are updated per delivery and it
 * becomes SENT (or FAILED when nothing could be delivered) once every recipient is accounted for.
 */
export async function sendCampaign(ctx: ServiceContext, id: string): Promise<SendCampaignResult> {
  const platform = await assertNewsletterEnabled(ctx.tenantId);
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { timezone: true } });

  const result = await db.$transaction(
    async (tx) => {
      // Serialize sends per tenant so two campaigns can't both pass the quota check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`newsletter-send:${ctx.tenantId}`}))`;
      const campaign = await tx.newsletterCampaign.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { status: true } });
      if (!campaign) throw new ServiceError("NOT_FOUND", "Campaign not found");
      if (campaign.status !== "DRAFT") throw new ServiceError("CONFLICT", "This campaign has already been sent");

      const recipients = await tx.newsletterSubscriber.findMany({
        where: { tenantId: ctx.tenantId, ...statusWhere("active") },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      if (recipients.length === 0) throw new ServiceError("INVALID", "There are no active subscribers");

      const { used } = await usedThisMonth(tx, ctx.tenantId, tenant.timezone);
      const quota = checkQuota({ quota: platform.newsletterQuota, used, needed: recipients.length });
      if (!quota.ok) throw new ServiceError("CONFLICT", "Monthly newsletter quota exceeded", quota);

      await tx.newsletterCampaign.update({
        where: { id },
        data: { status: "SENDING", sentAt: new Date(), recipientCount: recipients.length, sentCount: 0, failedCount: 0 },
      });

      const batches: { tenantId: string; campaignId: string; subscriberIds: string[] }[] = [];
      for (let i = 0; i < recipients.length; i += CAMPAIGN_BATCH_SIZE) {
        batches.push({
          tenantId: ctx.tenantId,
          campaignId: id,
          subscriberIds: recipients.slice(i, i + CAMPAIGN_BATCH_SIZE).map((r) => r.id),
        });
      }
      await enqueueMany("newsletter.campaign.batch", batches, { tx });
      return { recipientCount: recipients.length, batches: batches.length };
    },
    { timeout: 30_000 },
  );

  await audit({
    action: "newsletter.campaign.sent",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "NewsletterCampaign",
    entityId: id,
    data: result,
  });
  return result;
}

/** Job handler for one fan-out batch (see jobs.ts). Runs in the worker. */
export async function processCampaignBatch(input: { tenantId: string; campaignId: string; subscriberIds: string[] }) {
  const { tenantId, campaignId, subscriberIds } = input;
  const campaign = await db.newsletterCampaign.findFirst({ where: { id: campaignId, tenantId }, select: { status: true } });
  if (!campaign || campaign.status !== "SENDING") return { queued: 0, skipped: subscriberIds.length };

  const active = await db.newsletterSubscriber.findMany({
    where: { tenantId, id: { in: subscriberIds }, ...statusWhere("active") },
    select: { id: true },
  });
  const skipped = subscriberIds.length - active.length;

  // Queue + bookkeeping commit together, so a retried batch never queues twice after a partial run.
  await db.$transaction(async (tx) => {
    await enqueueMany(
      "mail.send",
      active.map((s) => ({ tenantId, template: "newsletter-campaign" as const, props: { campaignId, subscriberId: s.id } })),
      { tx },
    );
    if (skipped > 0) await recordCampaignDelivery(campaignId, { skipped }, tx);
  });
  return { queued: active.length, skipped };
}

/**
 * Atomically bumps a campaign's counters; when every recipient is accounted for, SENDING becomes
 * SENT (or FAILED if nothing was delivered). `skipped` = recipients that unsubscribed meanwhile:
 * they are removed from recipientCount (and therefore from the quota usage).
 */
export async function recordCampaignDelivery(
  campaignId: string,
  delta: { sent?: number; failed?: number; skipped?: number },
  client: Prisma.TransactionClient | typeof db = db,
): Promise<void> {
  const sent = delta.sent ?? 0;
  const failed = delta.failed ?? 0;
  const skipped = delta.skipped ?? 0;
  await client.$executeRaw`
    UPDATE "newsletter_campaigns" SET
      "sentCount" = "sentCount" + ${sent},
      "failedCount" = "failedCount" + ${failed},
      "recipientCount" = GREATEST(0, "recipientCount" - ${skipped}),
      "status" = CASE
        WHEN "status" = 'SENDING' AND "sentCount" + ${sent} + "failedCount" + ${failed} >= GREATEST(0, "recipientCount" - ${skipped})
          THEN (CASE WHEN "sentCount" + ${sent} = 0 AND "failedCount" + ${failed} > 0 THEN 'FAILED' ELSE 'SENT' END)::"CampaignStatus"
        ELSE "status"
      END,
      "updatedAt" = NOW()
    WHERE "id" = ${campaignId}`;
}

