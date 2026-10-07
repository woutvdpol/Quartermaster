import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { getSettings } from "@/server/settings";
import { subscribe, subscriberStatus, type SubscriberStatus } from "@/server/newsletter";

/*
 * Newsletter preference on the account page. Subscribing always goes through double opt-in
 * (`subscribe` → confirmation mail); unsubscribing takes effect at once.
 */

export type NewsletterPreference = { enabled: boolean; status: SubscriberStatus | "none" };

export async function getNewsletterPreference(tenantId: string, email: string): Promise<NewsletterPreference> {
  const platform = await getSettings(tenantId, "platform");
  const row = await db.newsletterSubscriber.findUnique({ where: { tenantId_email: { tenantId, email } } });
  return { enabled: platform.newsletterEnabled, status: row ? subscriberStatus(row) : "none" };
}

export type SetNewsletterResult = { ok: true; status: SubscriberStatus | "none" } | { ok: false; error: "unavailable" | "rate_limited" };

export async function setNewsletterPreference(
  owner: { tenantId: string; customerId: string; email: string; userId: string },
  subscribed: boolean,
): Promise<SetNewsletterResult> {
  if (subscribed) {
    try {
      const res = await subscribe(owner.tenantId, owner.email, { source: "account", customerId: owner.customerId });
      if (res.status === "rate_limited") return { ok: false, error: "rate_limited" };
      return { ok: true, status: res.status === "already_subscribed" ? "active" : "pending" };
    } catch {
      return { ok: false, error: "unavailable" };
    }
  }
  const row = await db.newsletterSubscriber.findUnique({ where: { tenantId_email: { tenantId: owner.tenantId, email: owner.email } } });
  if (!row || row.unsubscribedAt) return { ok: true, status: row ? "unsubscribed" : "none" };
  await db.newsletterSubscriber.update({ where: { id: row.id }, data: { unsubscribedAt: new Date(), confirmTokenHash: null } });
  await audit({
    action: "newsletter.unsubscribed",
    tenantId: owner.tenantId,
    actorId: owner.userId,
    entity: "NewsletterSubscriber",
    entityId: row.id,
    data: { via: "account" },
  });
  return { ok: true, status: "unsubscribed" };
}
