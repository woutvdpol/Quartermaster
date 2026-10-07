import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { getNewsletterQuota } from "@/server/newsletter";
import { copy } from "../../_copy";
import { CampaignEditor } from "../../_components/CampaignEditor";
import { NewsletterDisabled } from "../../_components/NewsletterDisabled";

export const metadata: Metadata = { title: copy.editor.titleNew };

export default async function NewCampaignPage() {
  const ctx = await requireStaffContext();
  const quota = await getNewsletterQuota(ctx);
  return (
    <>
      <PageHeader
        crumb={
          <>
            {copy.crumb} ›{" "}
            <Link
              href="/admin/newsletter"
              className="hover:text-ink hover:underline"
            >
              {copy.title}
            </Link>
          </>
        }
        title={copy.editor.titleNew}
      />
      <div className="p-4 md:px-[22px] md:py-5">
        {quota.enabled ? (
          <CampaignEditor
            campaign={null}
            send={null}
            defaultTestEmail={ctx.actor.email}
          />
        ) : (
          <NewsletterDisabled />
        )}
      </div>
    </>
  );
}
