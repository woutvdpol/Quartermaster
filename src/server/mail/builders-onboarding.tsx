import "server-only";
import type { z } from "zod";
import { db } from "@/server/db";
import { decrypt } from "@/server/auth/encryption";
import { hashToken } from "@/server/auth/tokens";
import PlatformNotice from "@/emails/PlatformNotice";
import { APPLICATION_VERIFY_TTL_HOURS, verifyApplicationToken } from "@/server/onboarding/verify-token";
import { CURRENT_PLATFORM_LABELS, DEALER_INVITE_TTL_HOURS, type CurrentPlatform } from "@/server/onboarding/rules";
import { countryName } from "@/server/shipping/countries";
import type { MAIL_TEMPLATE_PROPS } from "./contracts";
import type { BuiltMail } from "./builders";
import type { MailIdentity } from "./identity";
import { MAIL_PATHS, platformBaseUrl, withQuery } from "./urls";

/*
 * Builders for the onboarding mails (dealer sign-up → approval → invite). Spread into MAIL_BUILDERS in
 * ./builders.tsx. Like the other builders they re-check the current state when the mail is sent and
 * return null (skip) when it is no longer relevant.
 */

type OnboardingTemplate = "dealer-application-verify" | "dealer-application-rejected" | "dealer-invite" | "platform-admin-notice";
type Input<T extends OnboardingTemplate> = {
  tenantId: string | null;
  to?: string;
  props: z.output<(typeof MAIL_TEMPLATE_PROPS)[T]>;
  identity: MailIdentity;
};

function platformLabel(value: string | null): string {
  return value && value in CURRENT_PLATFORM_LABELS ? CURRENT_PLATFORM_LABELS[value as CurrentPlatform] : value || "—";
}

export const ONBOARDING_MAIL_BUILDERS = {
  "dealer-application-verify": async ({ props, identity }: Input<"dealer-application-verify">): Promise<BuiltMail | null> => {
    const app = await db.dealerApplication.findUnique({
      where: { id: props.applicationId },
      select: { id: true, status: true, email: true, applicantName: true, shopName: true, emailVerifiedAt: true },
    });
    if (!app || app.status !== "PENDING" || app.emailVerifiedAt) return null;
    const token = decrypt(props.tokenEnc);
    if (verifyApplicationToken(token) !== app.id) return null; // expired or not for this application
    const url = withQuery(platformBaseUrl(), MAIL_PATHS.dealerApplicationVerify, { token });
    return {
      to: app.email,
      subject: "Confirm your email — your Quartermaster application",
      react: (
        <PlatformNotice
          brand={identity.brand}
          preview={`We received your application for ${app.shopName}. Please confirm your email address.`}
          heading="Thanks for applying"
          paragraphs={[
            `Hi ${app.applicantName}, we received your application to open “${app.shopName}” on Quartermaster.`,
            "Please confirm your email address so we can start the review. Every dealer is checked by hand, because militaria is a sensitive category. We email you as soon as your application has been reviewed.",
          ]}
          button={{ label: "Confirm my email", href: url }}
          footnote={`The link expires in ${APPLICATION_VERIFY_TTL_HOURS} hours. Didn't apply? Then you can ignore this email.`}
        />
      ),
    };
  },

  "dealer-application-rejected": async ({ props, identity }: Input<"dealer-application-rejected">): Promise<BuiltMail | null> => {
    const app = await db.dealerApplication.findUnique({
      where: { id: props.applicationId },
      select: { status: true, email: true, applicantName: true, shopName: true, rejectReason: true },
    });
    if (!app || app.status !== "REJECTED") return null;
    return {
      to: app.email,
      subject: "Your Quartermaster application",
      react: (
        <PlatformNotice
          brand={identity.brand}
          preview={`About your application for ${app.shopName}`}
          heading="About your application"
          paragraphs={[
            `Hi ${app.applicantName}, thank you for your interest in opening “${app.shopName}” on Quartermaster.`,
            "After reviewing your application we are unable to approve it at this time.",
            ...(app.rejectReason ? [`Reason: ${app.rejectReason}`] : []),
            "If you think this is a mistake or your situation changes, you are welcome to reply to this email or apply again.",
          ]}
        />
      ),
    };
  },

  "dealer-invite": async ({ tenantId, props, identity }: Input<"dealer-invite">): Promise<BuiltMail | null> => {
    if (!tenantId) throw new Error("dealer-invite: tenantId is required");
    const user = await db.user.findFirst({
      where: { id: props.userId, tenantId, role: "OWNER" },
      select: { email: true, name: true, passwordHash: true, disabledAt: true },
    });
    if (!user || user.passwordHash !== null || user.disabledAt) return null; // accepted, disabled or gone
    const token = decrypt(props.tokenEnc);
    const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.userId !== props.userId || row.type !== "INVITE" || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
    const url = withQuery(identity.brand.baseUrl, MAIL_PATHS.dealerInviteAccept, { token });
    return {
      to: user.email,
      subject: `Your shop ${identity.brand.name} is approved`,
      react: (
        <PlatformNotice
          brand={identity.brand}
          preview="Choose a password and set up your shop."
          heading="Your shop is approved"
          paragraphs={[
            `${user.name ? `Hi ${user.name}, w` : "W"}elcome to Quartermaster! Your shop “${identity.brand.name}” has been created at ${identity.brand.baseUrl.replace(/^https?:\/\//, "")}.`,
            "Choose a password to sign in. A setup wizard then walks you through business details, payments, shipping, importing your products and the legal pages.",
          ]}
          button={{ label: "Choose your password", href: url }}
          footnote={`The link works once and expires in ${DEALER_INVITE_TTL_HOURS} hours. Expired? Reply to this email and we send a new one.`}
        />
      ),
    };
  },

  "platform-admin-notice": async ({ to, props, identity }: Input<"platform-admin-notice">): Promise<BuiltMail | null> => {
    if (!to) throw new Error("platform-admin-notice: recipient (to) is required");
    const base = platformBaseUrl();
    if (props.kind === "application") {
      if (!props.applicationId) return null;
      const app = await db.dealerApplication.findUnique({ where: { id: props.applicationId } });
      if (!app || app.status !== "PENDING") return null;
      return {
        to,
        subject: `New dealer application: ${app.shopName}`,
        react: (
          <PlatformNotice
            brand={identity.brand}
            preview={`${app.applicantName} applied for ${app.shopName}`}
            heading="New dealer application"
            paragraphs={["A dealer confirmed their email address and is waiting for review."]}
            details={[
              { label: "Shop", value: app.shopName },
              { label: "Applicant", value: `${app.applicantName} <${app.email}>` },
              { label: "Country", value: countryName(app.country) },
              { label: "CoC number", value: app.cocNumber || "—" },
              { label: "Sells via", value: platformLabel(app.currentPlatform) },
            ]}
            button={{ label: "Review application", href: withQuery(base, MAIL_PATHS.platformApplications, { id: app.id }) }}
          />
        ),
      };
    }
    if (!props.tenantId) return null;
    const tenant = await db.tenant.findUnique({ where: { id: props.tenantId }, select: { id: true, name: true, slug: true } });
    if (!tenant) return null;
    const href = `${base}/admin/platform/${tenant.id}`;
    if (props.kind === "migration") {
      return {
        to,
        subject: `Concept500 migration requested: ${tenant.name}`,
        react: (
          <PlatformNotice
            brand={identity.brand}
            preview={`${tenant.name} wants to migrate from Concept500`}
            heading="Concept500 migration requested"
            paragraphs={[
              `The owner of “${tenant.name}” chose “Concept500 — we do this with you” in the setup wizard.`,
              "Plan the migration (products, orders, customers) with the dealer and run the ETL for this tenant.",
            ]}
            details={[{ label: "Shop", value: `${tenant.name} (${tenant.slug})` }, ...(props.detail ? [{ label: "Note", value: props.detail }] : [])]}
            button={{ label: "Open shop in platform admin", href }}
          />
        ),
      };
    }
    return {
      to,
      subject: `Own domain requested: ${tenant.name}`,
      react: (
        <PlatformNotice
          brand={identity.brand}
          preview={`${tenant.name} wants to use ${props.detail ?? "an own domain"}`}
          heading="Own domain requested"
          paragraphs={[
            `The owner of “${tenant.name}” asked to connect an own domain. Check the DNS record, add the domain to the shop (and to the ingress / TLS certificate), then make it primary.`,
          ]}
          details={[
            { label: "Shop", value: `${tenant.name} (${tenant.slug})` },
            { label: "Domain", value: props.detail ?? "—" },
          ]}
          button={{ label: "Open shop in platform admin", href }}
        />
      ),
    };
  },
};
