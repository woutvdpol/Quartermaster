import "server-only";
import type { ReactElement } from "react";
import { db } from "@/server/db";
import { decrypt } from "@/server/auth/encryption";
import { hashToken } from "@/server/auth/tokens";
import PasswordReset, { passwordResetSubject } from "@/emails/PasswordReset";
import OrderConfirmationCustomer, { orderConfirmationCustomerSubject } from "@/emails/OrderConfirmationCustomer";
import OrderConfirmationOwner, { orderConfirmationOwnerSubject } from "@/emails/OrderConfirmationOwner";
import NewsletterConfirm, { newsletterConfirmSubject } from "@/emails/NewsletterConfirm";
import NewsletterCampaign from "@/emails/NewsletterCampaign";
import { renderMarkdown } from "@/server/newsletter/markdown";
import { unsubscribeQuery } from "@/server/newsletter/signing";
import { CONFIRM_TOKEN_TTL_DAYS, subscriberStatus } from "@/server/newsletter/subscribers";
import type { MailTemplateName } from "./contracts";
import { loadMailIdentity, type MailIdentity } from "./identity";
import { loadOrderMailData } from "./order-data";
import { MAIL_PATHS, withQuery } from "./urls";
import type { z } from "zod";
import type { MAIL_TEMPLATE_PROPS } from "./contracts";
import LeadReceived, { leadReceivedSubject } from "@/emails/LeadReceived";
import LeadReceivedConfirmation, { leadReceivedConfirmationSubject } from "@/emails/LeadReceivedConfirmation";
import { leadAdminPath, loadLeadMailData } from "@/server/leads/mail-data";
import { OPS_MAIL_BUILDERS } from "./builders-ops";
import { COMMERCE_MAIL_BUILDERS } from "./builders-commerce";
import { ONBOARDING_MAIL_BUILDERS } from "./builders-onboarding";
import { ALERT_MAIL_BUILDERS } from "@/server/alerts/mail";

/** What a template builder hands to `sendMail()`. `null` = nothing to send (skip, not an error). */
export type BuiltMail = {
  to: string;
  subject: string;
  react: ReactElement;
  replyTo?: string | null;
  headers?: Record<string, string>;
};

type BuilderInput<T extends MailTemplateName> = {
  tenantId: string | null;
  to?: string;
  props: z.output<(typeof MAIL_TEMPLATE_PROPS)[T]>;
  identity: MailIdentity;
};

type Builder<T extends MailTemplateName> = (input: BuilderInput<T>) => Promise<BuiltMail | null>;

const RESET_TTL_MINUTES = 30; // src/server/auth/service.ts RESET_TOKEN_TTL_MS

function requireTo(to: string | undefined, template: string): string {
  if (!to) throw new Error(`${template}: recipient (to) is required`);
  return to;
}

function requireTenant(tenantId: string | null, template: string): string {
  if (!tenantId) throw new Error(`${template}: tenantId is required`);
  return tenantId;
}

/** RFC 2369 + RFC 8058 one-click unsubscribe headers. */
export function listUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

export const MAIL_BUILDERS: { [T in MailTemplateName]: Builder<T> } = {
  "password-reset": async ({ to, props, identity }) => {
    const token = decrypt(props.tokenEnc);
    const path = props.audience === "admin" ? MAIL_PATHS.adminPasswordReset : MAIL_PATHS.customerPasswordReset;
    const resetUrl = withQuery(identity.brand.baseUrl, path, { token });
    return {
      to: requireTo(to, "password-reset"),
      subject: passwordResetSubject(identity.brand),
      react: <PasswordReset brand={identity.brand} resetUrl={resetUrl} expiresInMinutes={RESET_TTL_MINUTES} />,
    };
  },

  "order-confirmation-customer": async ({ tenantId, props, identity }) => {
    const order = await loadOrderMailData(requireTenant(tenantId, "order-confirmation-customer"), props.orderId, identity.brand.baseUrl);
    if (!order) return null;
    return {
      to: order.email,
      subject: orderConfirmationCustomerSubject(identity.brand, order),
      react: (
        <OrderConfirmationCustomer
          brand={identity.brand}
          order={order}
          message={identity.confirmationMessage || undefined}
          timeZone={identity.timeZone}
        />
      ),
    };
  },

  "order-confirmation-owner": async ({ tenantId, props, identity }) => {
    if (!identity.ownerEmail) {
      console.warn(`[mail] tenant ${tenantId} has no order notification / contact email; owner mail skipped`);
      return null;
    }
    const order = await loadOrderMailData(requireTenant(tenantId, "order-confirmation-owner"), props.orderId, identity.brand.baseUrl);
    if (!order) return null;
    return {
      to: identity.ownerEmail,
      subject: orderConfirmationOwnerSubject(order),
      replyTo: order.email,
      react: (
        <OrderConfirmationOwner
          brand={identity.brand}
          order={order}
          adminUrl={`${identity.brand.baseUrl}${MAIL_PATHS.adminOrder(order.id)}`}
          timeZone={identity.timeZone}
        />
      ),
    };
  },

  "newsletter-confirm": async ({ tenantId, props, identity }) => {
    const sub = await db.newsletterSubscriber.findFirst({
      where: { id: props.subscriberId, tenantId: requireTenant(tenantId, "newsletter-confirm") },
    });
    const token = decrypt(props.tokenEnc);
    // Gone, already active, or a newer confirmation mail superseded this one.
    if (!sub || subscriberStatus(sub) === "active" || sub.confirmTokenHash !== hashToken(token)) return null;
    const confirmUrl = withQuery(identity.brand.baseUrl, MAIL_PATHS.newsletterConfirm, { token });
    return {
      to: sub.email,
      subject: newsletterConfirmSubject(identity.brand),
      react: <NewsletterConfirm brand={identity.brand} confirmUrl={confirmUrl} expiresInDays={CONFIRM_TOKEN_TTL_DAYS} />,
    };
  },

  "newsletter-campaign": async ({ tenantId, props, identity }) => {
    const tid = requireTenant(tenantId, "newsletter-campaign");
    const [campaign, sub] = await Promise.all([
      db.newsletterCampaign.findFirst({ where: { id: props.campaignId, tenantId: tid }, select: { subject: true, body: true, status: true } }),
      db.newsletterSubscriber.findFirst({ where: { id: props.subscriberId, tenantId: tid } }),
    ]);
    if (!campaign || campaign.status !== "SENDING" || !sub || subscriberStatus(sub) !== "active") return null;
    const unsubscribeUrl = withQuery(identity.brand.baseUrl, MAIL_PATHS.newsletterUnsubscribe, unsubscribeQuery(tid, sub.id));
    return {
      to: sub.email,
      subject: campaign.subject,
      headers: listUnsubscribeHeaders(unsubscribeUrl),
      react: (
        <NewsletterCampaign brand={identity.brand} subject={campaign.subject} bodyHtml={renderMarkdown(campaign.body)} unsubscribeUrl={unsubscribeUrl} />
      ),
    };
  },

  "newsletter-campaign-test": async ({ tenantId, to, props, identity }) => {
    const campaign = await db.newsletterCampaign.findFirst({
      where: { id: props.campaignId, tenantId: requireTenant(tenantId, "newsletter-campaign-test") },
      select: { subject: true, body: true },
    });
    if (!campaign) return null;
    const placeholder = `${identity.brand.baseUrl}${MAIL_PATHS.newsletterStatusPage}`;
    return {
      to: requireTo(to, "newsletter-campaign-test"),
      subject: `[Test] ${campaign.subject}`,
      react: (
        <NewsletterCampaign
          brand={identity.brand}
          subject={campaign.subject}
          bodyHtml={renderMarkdown(campaign.body)}
          unsubscribeUrl={placeholder}
          notice="This is a test send. Subscribers get a personal unsubscribe link here."
        />
      ),
    };
  },
  // admin-ops templates: order-shipped, owner-invite, customer-email-verification
  ...OPS_MAIL_BUILDERS,
  ...COMMERCE_MAIL_BUILDERS,
  ...ONBOARDING_MAIL_BUILDERS,
  ...ALERT_MAIL_BUILDERS, // alert-confirm, alert-new-arrivals, alert-back-available, alert-price-drop

  "lead-received": async ({ tenantId, props, identity }) => {
    if (!identity.ownerEmail) {
      console.warn(`[mail] tenant ${tenantId} has no order notification / contact email; lead mail skipped`);
      return null;
    }
    const lead = await loadLeadMailData(requireTenant(tenantId, "lead-received"), props.leadId, identity.brand.baseUrl);
    if (!lead) return null;
    return {
      to: identity.ownerEmail,
      subject: leadReceivedSubject(lead),
      replyTo: lead.email,
      react: (
        <LeadReceived
          brand={identity.brand}
          lead={lead}
          adminUrl={`${identity.brand.baseUrl}${leadAdminPath(props.leadId)}`}
          timeZone={identity.timeZone}
        />
      ),
    };
  },

  "lead-received-confirmation": async ({ tenantId, props, identity }) => {
    const lead = await loadLeadMailData(requireTenant(tenantId, "lead-received-confirmation"), props.leadId, identity.brand.baseUrl);
    if (!lead) return null;
    return {
      to: lead.email,
      subject: leadReceivedConfirmationSubject(identity.brand),
      react: <LeadReceivedConfirmation brand={identity.brand} lead={lead} />,
    };
  },
};

export async function buildMail<T extends MailTemplateName>(
  template: T,
  input: Omit<BuilderInput<T>, "identity">,
): Promise<BuiltMail | null> {
  const identity = await loadMailIdentity(input.tenantId);
  return (MAIL_BUILDERS[template] as Builder<T>)({ ...input, identity });
}
