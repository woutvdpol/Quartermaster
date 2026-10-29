import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { queueMail } from "@/server/mail/queue";
import { notifySuperadmins } from "./applications";
import { dueTrialNotice, TRIAL_NOTICE } from "./trial-rules";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cron `trials.tick` (hourly): sends the trial reminder / ended mails that are due (docs/signup-modes.md).
 * The storefront closes by itself at trialEndsAt (src/server/storefront/launch.ts); this only mails.
 * Each notice is claimed with a compare-and-set on Tenant.trialNotices inside the transaction that
 * queues the owner mails, so concurrent runs never send one twice.
 */
export async function runTrialNotices(now: Date = new Date()): Promise<{ notices: number }> {
  const tenants = await db.tenant.findMany({
    where: { status: "ACTIVE", trialEndsAt: { not: null, lte: new Date(now.getTime() + WEEK_MS) }, trialNotices: { lt: TRIAL_NOTICE.ended } },
    select: { id: true, trialEndsAt: true, trialNotices: true },
    take: 500,
  });
  let notices = 0;
  for (const t of tenants) {
    const notice = dueTrialNotice(t.trialEndsAt!, t.trialNotices, now);
    if (notice === null) continue;
    const sent = await db.$transaction(async (tx) => {
      const claimed = await tx.tenant.updateMany({ where: { id: t.id, trialNotices: t.trialNotices, trialEndsAt: t.trialEndsAt }, data: { trialNotices: notice } });
      if (claimed.count === 0) return false;
      const owners = await tx.user.findMany({ where: { tenantId: t.id, role: "OWNER", disabledAt: null }, select: { id: true } });
      for (const o of owners) await queueMail({ tenantId: t.id, template: "trial-notice", props: { userId: o.id, notice } }, { tx });
      return true;
    });
    if (!sent) continue;
    notices++;
    await audit({ action: "trial.notice_sent", tenantId: t.id, entity: "Tenant", entityId: t.id, data: { notice } });
    if (notice === TRIAL_NOTICE.ended) await notifySuperadmins({ kind: "trial-ended", tenantId: t.id });
  }
  return { notices };
}
