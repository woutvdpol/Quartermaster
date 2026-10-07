import { z } from "zod";
import { ALERT_MAIL_PROPS } from "@/server/alerts/mail-contracts";

/**
 * Serializable inputs of the queued mail templates. Kept free of React/DB imports so it can be
 * loaded anywhere (Next.js server code, the worker, tests). The heavy builders that turn these
 * props into a rendered mail live in `./builders.tsx` and only run in the worker.
 *
 * Props carry ids, not data: the builder loads fresh data when the mail is sent. Secrets (raw
 * tokens) are AES-GCM encrypted (`*Enc`, see src/server/auth/encryption.ts) so the job table never
 * holds a usable token.
 */
const id = z.string().min(1).max(64);

export const MAIL_TEMPLATE_PROPS = {
  "password-reset": z.object({
    tokenEnc: z.string().min(1),
    /** Which login area the link opens. */
    audience: z.enum(["admin", "customer"]),
  }),
  "order-confirmation-customer": z.object({ orderId: id }),
  "order-confirmation-owner": z.object({ orderId: id }),
  "newsletter-confirm": z.object({ subscriberId: id, tokenEnc: z.string().min(1) }),
  "newsletter-campaign": z.object({ campaignId: id, subscriberId: id }),
  "newsletter-campaign-test": z.object({ campaignId: id }),
  ...ALERT_MAIL_PROPS, // alert-confirm, alert-new-arrivals, alert-back-available, alert-price-drop
  // "Sell your collection" leads (src/server/leads): owner notification + seller confirmation.
  "lead-received": z.object({ leadId: id }),
  "lead-received-confirmation": z.object({ leadId: id }),
  // ── admin-ops (phase 5): builders in ./builders-ops.tsx ──
  "order-shipped": z.object({ orderId: id }),
  "owner-invite": z.object({ userId: id, tokenEnc: z.string().min(1), invitedBy: z.string().max(254).nullish() }),
  "customer-email-verification": z.object({ userId: id, tokenEnc: z.string().min(1) }),
  // ── commerce (phase 5): offers + abandoned cart; builders in ./builders-commerce.tsx ──
  "offer-received": z.object({ offerId: id }),
  "offer-submitted": z.object({ offerId: id }),
  "offer-accepted": z.object({ offerId: id, tokenEnc: z.string().min(1) }),
  "offer-countered": z.object({ offerId: id, tokenEnc: z.string().min(1) }),
  "offer-rejected": z.object({ offerId: id }),
  "abandoned-cart": z.object({ cartId: id }),
} as const;

export type MailTemplateName = keyof typeof MAIL_TEMPLATE_PROPS;
export type MailTemplateProps<T extends MailTemplateName> = z.input<(typeof MAIL_TEMPLATE_PROPS)[T]>;

export const MAIL_TEMPLATE_NAMES = Object.keys(MAIL_TEMPLATE_PROPS) as [MailTemplateName, ...MailTemplateName[]];

/** Payload of the `mail.send` job. */
export const mailJobSchema = z
  .object({
    /** null = platform mail (e.g. SUPERADMIN password reset). */
    tenantId: id.nullable(),
    template: z.enum(MAIL_TEMPLATE_NAMES),
    props: z.record(z.string(), z.unknown()),
    /** Recipient; templates that derive it themselves (order mails, campaigns) ignore it. */
    to: z.email().max(254).optional(),
  })
  .superRefine((v, ctx) => {
    const res = MAIL_TEMPLATE_PROPS[v.template].safeParse(v.props);
    if (!res.success) {
      for (const issue of res.error.issues) ctx.addIssue({ ...issue, path: ["props", ...issue.path] } as never);
    }
  });

export type MailJob = z.output<typeof mailJobSchema>;

/** Mail jobs: 6 attempts with exponential backoff (≈1 min → capped at 1 h). */
export const MAIL_QUEUE_OPTIONS = {
  retryLimit: 5,
  retryDelay: 60,
  retryBackoff: true,
  retryDelayMax: 60 * 60,
  expireInSeconds: 5 * 60,
  // Payloads reference personal data (order/subscriber ids); don't keep completed jobs long.
  deleteAfterSeconds: 24 * 60 * 60,
};
