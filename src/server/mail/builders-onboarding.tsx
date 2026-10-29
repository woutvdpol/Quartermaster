import "server-only";
import type { z } from "zod";
import { db } from "@/server/db";
import { decrypt } from "@/server/auth/encryption";
import { hashToken } from "@/server/auth/tokens";
import PlatformNotice from "@/emails/PlatformNotice";
import { APPLICATION_VERIFY_TTL_HOURS, verifyApplicationToken } from "@/server/onboarding/verify-token";
import { CURRENT_PLATFORM_LABELS, DEALER_INVITE_TTL_HOURS, type CurrentPlatform } from "@/server/onboarding/rules";
import { countryName } from "@/server/shipping/countries";
import { trialState, TRIAL_NOTICE } from "@/server/onboarding/trial-rules";
import type { MAIL_TEMPLATE_PROPS } from "./contracts";
import type { BuiltMail } from "./builders";
import type { MailIdentity } from "./identity";
import { MAIL_PATHS, platformBaseUrl, withQuery } from "./urls";

/*
 * Builders for the onboarding mails (dealer sign-up → approval → invite). Spread into MAIL_BUILDERS in
 * ./builders.tsx. Like the other builders they re-check the current state when the mail is sent and
 * return null (skip) when it is no longer relevant.
 */

type OnboardingTemplate = "dealer-application-verify" | "dealer-application-rejected" | "dealer-invite" | "trial-notice" | "platform-admin-notice";
type Input<T extends OnboardingTemplate> = {
  tenantId: string | null;
  to?: string;
  props: z.output<(typeof MAIL_TEMPLATE_PROPS)[T]>;
  identity: MailIdentity;
};

function formatDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone }).format(date);
}

function platformLabel(value: string | null): string {
  return value && value in CURRENT_PLATFORM_LABELS ? CURRENT_PLATFORM_LABELS[value as CurrentPlatform] : value || "—";
}

export const ONBOARDING_MAIL_BUILDERS = {
  "dealer-application-verify": async ({ props, identity }: Input<"dealer-application-verify">): Promise<BuiltMail | null> => {
    const app = await db.dealerApplication.findUnique({
      where: { id: props.applicationId },
      select: { id: true, status: true, signupMode: true, email: true, applicantName: true, shopName: true, emailVerifiedAt: true },
    });
    if (!app || (app.status !== "PENDING" && app.status !== "WAITLISTED") || app.emailVerifiedAt) return null;
    const token = decrypt(props.tokenEnc);
    if (verifyApplicationToken(token) !== app.id) return null; // expired or not for this application
    const url = withQuery(platformBaseUrl(), MAIL_PATHS.dealerApplicationVerify, { token });
    // Text per sign-up mode at submission (docs/signup-modes.md).
    const copy =
      app.signupMode === "TRIAL"
        ? {
            subject: "Confirm your email — start your Quartermaster trial",
            preview: `Confirm your email address and your shop ${app.shopName} is created right away.`,
            heading: "Your trial is one click away",
            body: "Confirm your email address and we create your shop right away. You then choose a password and a setup wizard walks you through payments, shipping and importing your products.",
            button: "Confirm and create my shop",
          }
        : app.signupMode === "WAITLIST"
          ? {
              subject: "Confirm your email — Quartermaster waitlist",
              preview: `Confirm your email address to join the waitlist with ${app.shopName}.`,
              heading: "Thanks for joining the waitlist",
              body: "Please confirm your email address to take your place on the waitlist. We invite dealers in the order they signed up and email you as soon as there is room.",
              button: "Confirm my email",
            }
          : {
              subject: "Confirm your email — your Quartermaster application",
              preview: `We received your application for ${app.shopName}. Please confirm your email address.`,
              heading: "Thanks for applying",
              body: "Please confirm your email address so we can start the review. Every dealer is checked by hand, because militaria is a sensitive category. We email you as soon as your application has been reviewed.",
              button: "Confirm my email",
            };
    return {
      to: app.email,
      subject: copy.subject,
      react: (
        <PlatformNotice
          brand={identity.brand}
          preview={copy.preview}
          heading={copy.heading}
          paragraphs={[`Hi ${app.applicantName}, we received your request to open “${app.shopName}” on Quartermaster.`, copy.body]}
          button={{ label: copy.button, href: url }}
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
    const [user, tenant] = await Promise.all([
      db.user.findFirst({ where: { id: props.userId, tenantId, role: "OWNER" }, select: { email: true, name: true, passwordHash: true, disabledAt: true } }),
      db.tenant.findUnique({ where: { id: tenantId }, select: { trialEndsAt: true } }),
    ]);
    if (!user || user.passwordHash !== null || user.disabledAt) return null; // accepted, disabled or gone
    const token = decrypt(props.tokenEnc);
    const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.userId !== props.userId || row.type !== "INVITE" || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
    const url = withQuery(identity.brand.baseUrl, MAIL_PATHS.dealerInviteAccept, { token });
    // Trial shops were created without a review (docs/signup-modes.md): "ready", not "approved".
    const word = tenant?.trialEndsAt ? "ready" : "approved";
    return {
      to: user.email,
      subject: `Your shop ${identity.brand.name} is ${word}`,
      react: (
        <PlatformNotice
          brand={identity.brand}
          preview="Choose a password and set up your shop."
          heading={`Your shop is ${word}`}
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

  "trial-notice": async ({ tenantId, props, identity }: Input<"trial-notice">): Promise<BuiltMail | null> => {
    if (!tenantId) throw new Error("trial-notice: tenantId is required");
    const [tenant, user] = await Promise.all([
      db.tenant.findUnique({ where: { id: tenantId }, select: { trialEndsAt: true, timezone: true, status: true } }),
      db.user.findFirst({ where: { id: props.userId, tenantId, role: "OWNER", disabledAt: null }, select: { email: true, name: true } }),
    ]);
    if (!tenant || tenant.status !== "ACTIVE" || !user) return null;
    // Re-check: extended or converted since the notice was queued → skip.
    const state = trialState(tenant);
    const ended = props.notice === TRIAL_NOTICE.ended;
    if (state.kind === "none" || (ended ? state.kind !== "ended" : state.kind !== "running")) return null;
    const day = formatDay(state.endsAt, tenant.timezone);
    const hi = user.name ? `Hi ${user.name}, ` : "";
    const admin = `${identity.brand.baseUrl}/admin`;
    if (ended) {
      return {
        to: user.email,
        subject: `Your Quartermaster trial for ${identity.brand.name} has ended`,
        react: (
          <PlatformNotice
            brand={identity.brand}
            preview="Your shop is closed for visitors. Your admin and all your data are kept."
            heading="Your trial has ended"
            paragraphs={[
              `${hi}the free trial of “${identity.brand.name}” ended on ${day}. Visitors now see a “temporarily closed” page.`,
              "Your admin, products, orders and settings are kept. Reply to this email to choose a package, and we reopen your shop right away.",
            ]}
            button={{ label: "Open your admin", href: admin }}
          />
        ),
      };
    }
    const left = state.kind === "running" ? state.daysLeft : 0;
    return {
      to: user.email,
      subject: `Your Quartermaster trial ends on ${day}`,
      react: (
        <PlatformNotice
          brand={identity.brand}
          preview={`${left} ${left === 1 ? "day" : "days"} left in your free trial of ${identity.brand.name}.`}
          heading={left === 1 ? "One day left in your trial" : `${left} days left in your trial`}
          paragraphs={[
            `${hi}the free trial of “${identity.brand.name}” ends on ${day}.`,
            "After that your shop closes for visitors; your admin and all your data stay. Reply to this email to choose a package and keep your shop open without interruption.",
          ]}
          button={{ label: "Open your admin", href: admin }}
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
    const tenant = await db.tenant.findUnique({
      where: { id: props.tenantId },
      select: { id: true, name: true, slug: true, trialEndsAt: true, timezone: true, domains: { where: { isPrimary: true }, select: { host: true } } },
    });
    if (!tenant) return null;
    const href = `${base}/admin/platform/${tenant.id}`;
    if (props.kind === "trial" || props.kind === "trial-ended") {
      if (!tenant.trialEndsAt) return null; // converted in the meantime
      const app = props.applicationId ? await db.dealerApplication.findUnique({ where: { id: props.applicationId } }) : null;
      const started = props.kind === "trial";
      return {
        to,
        subject: started ? `New trial shop: ${tenant.name}` : `Trial ended: ${tenant.name}`,
        react: (
          <PlatformNotice
            brand={identity.brand}
            preview={started ? `${tenant.name} started a free trial` : `The trial of ${tenant.name} has ended; the storefront is closed`}
            heading={started ? "New trial shop" : "Trial ended"}
            paragraphs={[
              started
                ? "A dealer confirmed their email address and their shop was created automatically. They are now in the setup wizard. Suspend the shop in the platform admin if something is wrong."
                : "The storefront is closed for visitors; the admin stays open. Extend the trial or convert the shop to a package in the platform admin.",
            ]}
            details={[
              { label: "Shop", value: `${tenant.name} (${tenant.domains[0]?.host ?? tenant.slug})` },
              ...(app
                ? [
                    { label: "Applicant", value: `${app.applicantName} <${app.email}>` },
                    { label: "Country", value: countryName(app.country) },
                    { label: "CoC number", value: app.cocNumber || "—" },
                    { label: "Sells", value: app.description.slice(0, 200) },
                  ]
                : []),
              { label: started ? "Trial ends" : "Trial ended", value: formatDay(tenant.trialEndsAt, tenant.timezone) },
            ]}
            button={{ label: "Open shop in platform admin", href }}
          />
        ),
      };
    }
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
