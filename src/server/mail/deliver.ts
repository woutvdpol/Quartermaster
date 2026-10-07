import "server-only";
import type { JobRunContext } from "@/server/jobs/registry";
import { recordCampaignDelivery } from "@/server/newsletter/campaigns";
import { MAIL_TEMPLATE_PROPS, type MailJob, type MailTemplateName } from "./contracts";
import { MAIL_BUILDERS } from "./builders";
import { loadMailIdentity } from "./identity";
import { sendMail } from "./send";

export type DeliverResult = { status: "sent"; messageId: string; file?: string } | { status: "skipped" };

/** Handler of the `mail.send` job: build the template from fresh data, render, send. */
export async function deliverMailJob(job: MailJob, ctx: Pick<JobRunContext, "isFinalAttempt">): Promise<DeliverResult> {
  const template = job.template as MailTemplateName;
  const props = MAIL_TEMPLATE_PROPS[template].parse(job.props);
  const campaignId = template === "newsletter-campaign" ? (props as { campaignId: string }).campaignId : null;

  const identity = await loadMailIdentity(job.tenantId);
  const builder = MAIL_BUILDERS[template] as (input: unknown) => ReturnType<(typeof MAIL_BUILDERS)[MailTemplateName]>;
  const built = await builder({ tenantId: job.tenantId, to: job.to, props, identity });
  if (!built) {
    if (campaignId) await recordCampaignDelivery(campaignId, { skipped: 1 });
    return { status: "skipped" };
  }

  try {
    const sent = await sendMail(
      { tenantId: job.tenantId, to: built.to, subject: built.subject, react: built.react, replyTo: built.replyTo, headers: built.headers },
      identity,
    );
    if (campaignId) await recordCampaignDelivery(campaignId, { sent: 1 });
    return { status: "sent", ...sent };
  } catch (err) {
    if (campaignId && ctx.isFinalAttempt) await recordCampaignDelivery(campaignId, { failed: 1 });
    throw err;
  }
}
