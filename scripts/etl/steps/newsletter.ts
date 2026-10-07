import type { EtlContext } from "../context";
import { normalizeEmail } from "../transforms/people";

const DAY = 86_400_000;
/** Pending (never confirmed) sign-ups older than this are not imported (no consent). */
export const PENDING_MAX_AGE_DAYS = 30;

/**
 * Legacy `emailer_subscribers` → NewsletterSubscriber, `emailer_mails` → NewsletterCampaign
 * (docs/schema.md §3). active → confirmedAt = email_verified_at (consent moment); unsubscribed →
 * unsubscribedAt; pending → only when recent (they must confirm again: legacy codes are not reused).
 * `last_updated_by_ip` and verification codes are not migrated (AVG).
 */
export async function newsletterStep(ctx: EtlContext) {
  const { tx, report, tenantId } = ctx;
  const subscribers = await ctx.legacy.read("emailer_subscribers");
  const mails = await ctx.legacy.read("emailer_mails");
  report.legacy("newsletter subscribers", subscribers.length);
  report.legacy("newsletter campaigns", mails.length);

  const customers = new Map((await tx.customer.findMany({ where: { tenantId }, select: { id: true, email: true } })).map((c) => [c.email, c.id]));
  const seen = new Set<string>();
  for (const s of subscribers) {
    const email = normalizeEmail(s.email_address);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      report.skip("newsletter subscribers", "ongeldig e-mailadres");
      continue;
    }
    if (seen.has(email)) {
      report.skip("newsletter subscribers", "dubbel");
      continue;
    }
    seen.add(email);
    const status = (s.verification_status ?? "").trim().toLowerCase();
    let confirmedAt: Date | null = null;
    let unsubscribedAt: Date | null = null;
    if (status === "active") confirmedAt = s.email_verified_at ?? s.updated_at ?? s.created_at;
    else if (status === "unsubscribed") {
      confirmedAt = s.email_verified_at;
      unsubscribedAt = s.updated_at ?? ctx.now;
    } else {
      const created = s.created_at ?? s.updated_at;
      if (!created || ctx.now.getTime() - created.getTime() > PENDING_MAX_AGE_DAYS * DAY) {
        report.skip("newsletter subscribers", `pending ouder dan ${PENDING_MAX_AGE_DAYS} dagen (geen toestemming)`);
        continue;
      }
    }
    const data = { confirmedAt, unsubscribedAt, confirmSentAt: s.email_sent_at, customerId: customers.get(email) ?? null };
    const existing = await tx.newsletterSubscriber.findUnique({ where: { tenantId_email: { tenantId, email } } });
    if (existing) {
      // A subscriber who (un)subscribed in Quartermaster after an earlier run keeps that state.
      if (existing.updatedAt > (s.updated_at ?? new Date(0)) && existing.source !== "import") {
        report.unchanged("newsletter subscribers");
        continue;
      }
      const same =
        existing.confirmedAt?.getTime() === confirmedAt?.getTime() &&
        existing.unsubscribedAt?.getTime() === unsubscribedAt?.getTime() &&
        existing.customerId === data.customerId;
      if (same) report.unchanged("newsletter subscribers");
      else {
        await tx.newsletterSubscriber.update({ where: { id: existing.id }, data });
        report.updated("newsletter subscribers");
      }
    } else {
      await tx.newsletterSubscriber.create({ data: { tenantId, email, source: "import", ...data, ...(s.created_at ? { createdAt: s.created_at } : {}) } });
      report.created("newsletter subscribers");
    }
  }

  for (const m of mails) {
    const createdAt = m.created_at ?? m.sent_at ?? ctx.now;
    const subject = (m.subject ?? "").trim().slice(0, 200) || `Newsletter ${m.id}`;
    const data = {
      subject,
      body: m.content ?? "",
      status: m.sent_at ? ("SENT" as const) : ("DRAFT" as const),
      sentAt: m.sent_at,
      sentCount: m.sent_count ?? 0,
      recipientCount: m.sent_count ?? 0,
    };
    const existing = await tx.newsletterCampaign.findFirst({ where: { tenantId, subject, createdAt } });
    if (existing) {
      await tx.newsletterCampaign.update({ where: { id: existing.id }, data });
      report.unchanged("newsletter campaigns");
    } else {
      await tx.newsletterCampaign.create({ data: { tenantId, createdAt, ...data } });
      report.created("newsletter campaigns");
    }
  }
}
