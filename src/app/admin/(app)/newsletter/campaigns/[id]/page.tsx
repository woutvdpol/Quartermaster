import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  ConfirmDialog,
  DateTime,
  EmptyState,
  InlineAlert,
  KeyValue,
  PageHeader,
  buttonClasses,
} from "@/components/admin/ui";
import { requireStaffContext, ServiceError } from "@/server/context";
import {
  getCampaign,
  getNewsletterQuota,
  subscriberCounts,
} from "@/server/newsletter";
import { requireTenantDisplay } from "@/server/tenant-display";
import { copy } from "../../_copy";
import { deleteCampaignAction } from "../../actions";
import { CampaignEditor } from "../../_components/CampaignEditor";
import { CampaignStatusPill } from "../../_components/CampaignStatusPill";
import { NewsletterDisabled } from "../../_components/NewsletterDisabled";
import { PreviewFrame } from "../../_components/PreviewFrame";
import { TestSendForm } from "../../_components/TestSendForm";
import { formatCount } from "../../_components/format";

export const metadata: Metadata = { title: "Campaign" };

const BASE = "/admin/newsletter";

const crumb = (
  <>
    {copy.crumb} ›{" "}
    <Link href={BASE} className="hover:text-ink hover:underline">
      {copy.title}
    </Link>
  </>
);

async function loadCampaign(
  ctx: Awaited<ReturnType<typeof requireStaffContext>>,
  id: string,
) {
  try {
    return await getCampaign(ctx, id);
  } catch (err) {
    if (err instanceof ServiceError && err.code === "NOT_FOUND") return null;
    throw err;
  }
}

export default async function CampaignPage({
  params,
}: PageProps<"/admin/newsletter/campaigns/[id]">) {
  const { id } = await params;
  const ctx = await requireStaffContext();
  const [campaign, quota, counts, tenant] = await Promise.all([
    loadCampaign(ctx, id),
    getNewsletterQuota(ctx),
    subscriberCounts(ctx),
    requireTenantDisplay(ctx.tenantId),
  ]);

  if (!campaign) {
    return (
      <>
        <PageHeader crumb={crumb} title={copy.errors.notFoundTitle} />
        <div className="p-4 md:px-[22px] md:py-5">
          <div className="rounded-card border border-line bg-panel shadow-card">
            <EmptyState
              title={copy.errors.notFoundTitle}
              body={copy.errors.notFoundBody}
              action={
                <Link
                  href={BASE}
                  className={buttonClasses({ variant: "primary" })}
                >
                  {copy.editor.back}
                </Link>
              }
            />
          </div>
        </div>
      </>
    );
  }

  const isDraft = campaign.status === "DRAFT";

  return (
    <>
      <PageHeader
        crumb={crumb}
        title={campaign.subject}
        actions={
          <>
            <CampaignStatusPill status={campaign.status} />
            {isDraft && (
              <ConfirmDialog
                trigger={copy.remove.trigger}
                title={copy.remove.title}
                description={copy.remove.body}
                confirmLabel={copy.remove.confirm}
                action={deleteCampaignAction}
                fields={{ id: campaign.id }}
              />
            )}
          </>
        }
      />
      <div className="p-4 md:px-[22px] md:py-5">
        {!quota.enabled ? (
          <NewsletterDisabled />
        ) : isDraft ? (
          <CampaignEditor
            campaign={{
              id: campaign.id,
              subject: campaign.subject,
              body: campaign.body,
              bodyHtml: campaign.bodyHtml,
            }}
            send={{
              activeCount: counts.active,
              unlimited: quota.unlimited,
              quota: quota.quota,
              used: quota.used,
              remaining: quota.remaining,
            }}
            defaultTestEmail={ctx.actor.email}
          />
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="grid gap-4">
              <InlineAlert tone="info">{copy.editor.readOnly}</InlineAlert>
              <Card title={copy.editor.stats}>
                <KeyValue
                  items={[
                    {
                      label: copy.campaigns.status,
                      value: <CampaignStatusPill status={campaign.status} />,
                    },
                    {
                      label: copy.campaigns.recipients,
                      value: formatCount(campaign.recipientCount),
                      mono: true,
                    },
                    {
                      label: copy.campaigns.sent,
                      value: formatCount(campaign.sentCount),
                      mono: true,
                    },
                    {
                      label: copy.campaigns.failed,
                      value: (
                        <span
                          className={
                            campaign.failedCount > 0 ? "text-crit" : undefined
                          }
                        >
                          {formatCount(campaign.failedCount)}
                        </span>
                      ),
                      mono: true,
                    },
                    {
                      label: copy.campaigns.sentAt,
                      value: (
                        <DateTime
                          value={campaign.sentAt}
                          timeZone={tenant.timeZone}
                        />
                      ),
                    },
                    {
                      label: copy.editor.created,
                      value: (
                        <DateTime
                          value={campaign.createdAt}
                          timeZone={tenant.timeZone}
                        />
                      ),
                    },
                  ]}
                />
              </Card>
              <Card title={copy.test.title}>
                <TestSendForm
                  campaignId={campaign.id}
                  defaultEmail={ctx.actor.email}
                />
              </Card>
            </div>
            <Card title={copy.editor.preview} className="lg:sticky lg:top-4">
              <PreviewFrame
                html={campaign.bodyHtml}
                title={copy.editor.previewTitle}
              />
              <p className="mt-2 text-xs text-muted">
                {copy.editor.previewNote}
              </p>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
