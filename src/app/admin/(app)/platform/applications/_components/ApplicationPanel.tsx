import Link from "next/link";
import { ConfirmDialog, DateTime, KeyValue, StatusPill, Textarea, buttonClasses, type StatusTone } from "@/components/admin/ui";
import { CURRENT_PLATFORM_LABELS, summarizeChecks, type ApplicationDetail, type CurrentPlatform } from "@/server/onboarding";
import { countryName } from "@/server/shipping/countries";
import { approveApplicationAction, rejectApplicationAction, resendDealerInviteAction } from "../actions";
import { NoteForm } from "./NoteForm";

export const APPLICATION_STATUS_LABEL = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected" } as const;
export const APPLICATION_STATUS_TONE: Record<keyof typeof APPLICATION_STATUS_LABEL, StatusTone> = { PENDING: "warn", APPROVED: "ok", REJECTED: "mute" };

export function platformLabel(value: string | null): string {
  return value && value in CURRENT_PLATFORM_LABELS ? CURRENT_PLATFORM_LABELS[value as CurrentPlatform] : value || "—";
}

/** Detail panel of one application (docs/design/onboarding/Approval.dc.html). */
export function ApplicationPanel({ app, closeHref }: { app: ApplicationDetail; closeHref: string }) {
  const checks = summarizeChecks(app.checks);
  const pending = app.status === "PENDING";
  return (
    <section aria-labelledby="application-title" className="grid content-start gap-4 rounded-card border border-line bg-panel p-4 shadow-card">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="type-label text-[11px] text-muted">Application · {APPLICATION_STATUS_LABEL[app.status]}</p>
          <h2 id="application-title" className="type-display text-xl break-words">
            {app.shopName}
          </h2>
        </div>
        <Link href={closeHref} className={buttonClasses({ size: "sm", variant: "ghost" })} aria-label="Close details">
          Close
        </Link>
      </header>

      <KeyValue
        items={[
          { label: "Applicant", value: `${app.applicantName}` },
          { label: "Email", value: <a href={`mailto:${app.email}`} className="underline-offset-2 hover:underline">{app.email}</a> },
          { label: "Country", value: countryName(app.country) },
          { label: "CoC", value: app.cocNumber || "—", mono: true },
          { label: "Sells via", value: platformLabel(app.currentPlatform) },
          { label: app.tenant ? "Shop address" : "Proposed address", value: app.proposedHost, mono: true },
          { label: "Received", value: <DateTime value={app.createdAt} format="datetime" /> },
          ...(app.reviewedAt ? [{ label: "Reviewed", value: <span><DateTime value={app.reviewedAt} format="datetime" />{app.reviewerEmail ? ` · ${app.reviewerEmail}` : ""}</span> }] : []),
        ]}
      />

      <div className="grid gap-1.5">
        <h3 className="type-label text-[11px] text-muted">Automated checks</h3>
        <ul className="flex flex-wrap gap-1.5">
          {checks.map((c) => (
            <li key={c.key}>
              <StatusPill tone={c.tone}>{c.label}</StatusPill>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-1.5">
        <h3 className="type-label text-[11px] text-muted">What they sell</h3>
        <p className="text-[13px] whitespace-pre-line">{app.description}</p>
      </div>

      {app.status === "REJECTED" && app.rejectReason ? (
        <div className="grid gap-1.5">
          <h3 className="type-label text-[11px] text-muted">Reject reason (sent to applicant)</h3>
          <p className="text-[13px] whitespace-pre-line">{app.rejectReason}</p>
        </div>
      ) : null}

      <NoteForm id={app.id} note={app.internalNote} />

      {pending ? (
        <>
          <div className="rounded-control border border-line bg-panel-2 p-3 text-[13px]">
            <p className="mb-1 font-medium">On approve</p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted">
              <li>Shop is created on {app.proposedHost} (own domain later)</li>
              <li>Owner account gets an invite link (24 h)</li>
              <li>The setup wizard opens at first login</li>
            </ul>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <ConfirmDialog
              trigger="Reject…"
              title={`Reject “${app.shopName}”?`}
              description="The applicant receives an email with your reason. This cannot be undone."
              confirmLabel="Reject application"
              tone="danger"
              action={rejectApplicationAction}
              fields={{ id: app.id }}
            >
              <Textarea label="Reason (sent to the applicant)" name="reason" rows={3} required maxLength={1000} />
            </ConfirmDialog>
            <ConfirmDialog
              trigger="Approve & send invite"
              triggerVariant="primary"
              title={`Approve “${app.shopName}”?`}
              description={
                app.emailVerifiedAt
                  ? `This creates the shop on ${app.proposedHost} and emails ${app.email} an invite link (24 h).`
                  : `The applicant has not confirmed their email yet. Approving creates the shop on ${app.proposedHost} and emails ${app.email} an invite link (24 h) anyway.`
              }
              confirmLabel="Approve & send invite"
              tone="primary"
              action={approveApplicationAction}
              fields={{ id: app.id }}
            />
          </div>
        </>
      ) : null}

      {app.status === "APPROVED" && app.tenant ? (
        <div className="grid gap-2 rounded-control border border-line bg-panel-2 p-3 text-[13px]">
          <p>
            Shop:{" "}
            <Link href={`/admin/platform/${app.tenant.id}`} className="font-medium underline-offset-2 hover:underline">
              {app.tenant.name}
            </Link>{" "}
            · {app.tenant.setupCompletedAt ? "live (setup finished)" : "setup wizard not finished"}
          </p>
          {app.owner?.invitePending ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted">The owner has not accepted the invite yet.</span>
              <ConfirmDialog
                trigger="Resend invite"
                triggerSize="sm"
                title="Send a new invite link?"
                description={`${app.email} gets a new link (valid 24 h). Older links stop working.`}
                confirmLabel="Send new invite"
                tone="primary"
                action={resendDealerInviteAction}
                fields={{ id: app.id }}
              />
            </div>
          ) : app.owner ? (
            <p className="text-muted">The owner has accepted the invite.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
