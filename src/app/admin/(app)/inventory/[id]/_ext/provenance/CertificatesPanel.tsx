"use client";

import { ConfirmDialog, DateTime, EmptyState, StatusPill, Textarea, buttonClasses } from "@/components/admin/ui";
import { issueCertificateAction, revokeCertificateAction } from "./actions";
import { provenanceCardCopy as copy } from "./_copy";

const t = copy.certificates;

export type CertificateRow = {
  id: string;
  code: string;
  issuedAt: Date;
  issuedByEmail: string | null;
  revokedAt: Date | null;
  reason: string | null;
  valid: boolean;
  pdfUrl: string;
  verifyUrl: string | null;
};

export function CertificatesPanel({
  productId,
  certificates,
  canIssue,
  timeZone,
}: {
  productId: string;
  certificates: CertificateRow[];
  /** Product status allows issuing (ACTIVE / RESERVED / SOLD). */
  canIssue: boolean;
  timeZone: string;
}) {
  const hasValid = certificates.some((c) => c.valid);
  return (
    <div className="grid gap-3">
      {certificates.length === 0 ? (
        <EmptyState compact title={t.heading} body={canIssue ? t.empty : t.notAllowed} />
      ) : (
        <ul className="grid divide-y divide-line rounded-control border border-line" aria-label={t.heading}>
          {certificates.map((c) => (
            <li key={c.id} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13.5px] font-medium tracking-wide">{c.code}</span>
                  <StatusPill tone={c.valid ? "ok" : "crit"}>{c.valid ? t.valid : t.revoked}</StatusPill>
                </p>
                <p className="text-xs text-muted">
                  <DateTime value={c.issuedAt} format="date" timeZone={timeZone} />
                  {c.issuedByEmail ? ` ${t.issuedBy(c.issuedByEmail)}` : ""}
                  {c.revokedAt ? (
                    <>
                      {" · "}
                      {t.revoked} <DateTime value={c.revokedAt} format="date" timeZone={timeZone} />
                      {c.reason ? ` — ${c.reason}` : ""}
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a href={c.pdfUrl} target="_blank" rel="noopener" className={buttonClasses({ size: "sm" })}>
                  {t.pdf}
                </a>
                {c.verifyUrl ? (
                  <a href={c.verifyUrl} target="_blank" rel="noopener" className={buttonClasses({ size: "sm", variant: "ghost" })}>
                    {t.verify}
                  </a>
                ) : null}
                {c.valid ? (
                  <ConfirmDialog
                    trigger={t.revoke}
                    triggerSize="sm"
                    title={t.revokeTitle}
                    description={t.revokeBody(c.code)}
                    confirmLabel={t.revoke}
                    action={revokeCertificateAction}
                    fields={{ id: c.id, productId }}
                  >
                    <Textarea label={t.reason} name="reason" hint={t.reasonHint} rows={3} required minLength={3} maxLength={500} />
                  </ConfirmDialog>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!hasValid ? (
        <div>
          <ConfirmDialog
            trigger={t.issue}
            triggerSize="sm"
            triggerVariant="primary"
            tone="primary"
            title={t.issueTitle}
            description={t.issueBody}
            confirmLabel={t.issue}
            action={issueCertificateAction}
            fields={{ productId }}
            disabled={!canIssue}
          />
          {!canIssue && certificates.length > 0 ? <p className="mt-1.5 text-xs text-muted">{t.notAllowed}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
