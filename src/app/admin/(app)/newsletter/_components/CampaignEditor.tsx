"use client";

import { useEffect, useRef, useState } from "react";
import {
  ActionMessage,
  ActionToast,
  Card,
  ConfirmDialog,
  FormActions,
  InlineAlert,
  Spinner,
  SubmitButton,
  TextInput,
  Textarea,
  useActionForm,
} from "@/components/admin/ui";
import { copy } from "../_copy";
import {
  previewCampaignAction,
  saveCampaignAction,
  sendCampaignAction,
} from "../actions";
import { formatCount } from "./format";
import { PreviewFrame } from "./PreviewFrame";
import { TestSendForm } from "./TestSendForm";

const t = copy.editor;

export type EditorCampaign = {
  id: string;
  subject: string;
  body: string;
  bodyHtml: string;
};
export type SendInfo = {
  activeCount: number;
  unlimited: boolean;
  quota: number;
  used: number;
  remaining: number | null;
};

/**
 * Draft editor: subject + Markdown body with a live, sandboxed preview (rendered server-side by
 * the same sanitizer the mail uses), plus "send test" and "send to everyone" once saved.
 */
export function CampaignEditor({
  campaign,
  send,
  defaultTestEmail,
}: {
  campaign: EditorCampaign | null;
  send: SendInfo | null;
  defaultTestEmail: string;
}) {
  const { state, formAction, pending, error } =
    useActionForm(saveCampaignAction);
  const [subject, setSubject] = useState(campaign?.subject ?? "");
  const [body, setBody] = useState(campaign?.body ?? "");
  const dirty = campaign
    ? subject.trim() !== campaign.subject || body.trim() !== campaign.body
    : subject.trim() !== "" || body.trim() !== "";

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty || pending) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, pending]);

  const preview = usePreview(
    body,
    campaign?.body ?? "",
    campaign?.bodyHtml ?? "",
  );

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid gap-4">
        <Card
          title={campaign ? copy.title : t.titleNew}
          aside={
            dirty ? <span className="text-warn">{t.unsaved}</span> : undefined
          }
        >
          <form action={formAction} className="grid gap-4" noValidate>
            {campaign && <input type="hidden" name="id" value={campaign.id} />}
            <ActionMessage state={state} showSuccess={false} />
            <ActionToast state={state} errors={false} />
            <TextInput
              label={t.subject}
              name="subject"
              required
              maxLength={200}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              hint={t.subjectHint}
              error={error("subject")}
            />
            <Textarea
              label={t.body}
              name="body"
              required
              rows={18}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              hint={t.bodyHint}
              error={error("body")}
              inputClassName="font-mono text-[13px]"
              spellCheck
            />
            <FormActions>
              <SubmitButton
                variant="primary"
                pendingLabel={t.saving}
                disabled={campaign !== null && !dirty}
              >
                {campaign ? t.save : t.create}
              </SubmitButton>
            </FormActions>
          </form>
        </Card>

        {campaign && send && (
          <>
            <Card title={copy.test.title}>
              <TestSendForm
                campaignId={campaign.id}
                defaultEmail={defaultTestEmail}
                blockedReason={dirty ? copy.test.saveFirst : undefined}
              />
            </Card>
            <SendCard campaignId={campaign.id} send={send} dirty={dirty} />
          </>
        )}
      </div>

      <Card
        title={t.preview}
        aside={
          preview.updating ? <Spinner label={t.previewUpdating} /> : undefined
        }
        className="lg:sticky lg:top-4"
      >
        {body.trim() ? (
          <PreviewFrame html={preview.html} title={t.previewTitle} />
        ) : (
          <p className="grid h-40 place-items-center rounded-control border border-dashed border-line text-[13px] text-muted">
            {t.previewEmpty}
          </p>
        )}
        <p className="mt-2 text-xs text-muted">{t.previewNote}</p>
      </Card>
    </div>
  );
}

/** Debounced server render of the Markdown body (same sanitizer as the mail). */
function usePreview(body: string, initialBody: string, initialHtml: string) {
  const [html, setHtml] = useState(initialHtml);
  const [updating, setUpdating] = useState(false);
  const rendered = useRef(initialBody);

  useEffect(() => {
    if (body === rendered.current || !body.trim()) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setUpdating(true);
      const result = await previewCampaignAction(body);
      if (cancelled) return;
      if (result.ok) {
        rendered.current = body;
        setHtml(result.html);
      }
      setUpdating(false);
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [body]);

  return { html, updating };
}

function SendCard({
  campaignId,
  send,
  dirty,
}: {
  campaignId: string;
  send: SendInfo;
  dirty: boolean;
}) {
  const s = copy.send;
  const n = send.activeCount;
  const overQuota =
    !send.unlimited && send.remaining !== null && n > send.remaining;
  const blocked = dirty
    ? s.saveFirst
    : n === 0
      ? s.noRecipients
      : overQuota
        ? s.overQuota(formatCount(send.remaining ?? 0))
        : null;

  return (
    <Card title={s.title}>
      <div className="grid gap-3 text-[13.5px]">
        <p className="text-ink-2">
          {s.recipients(formatCount(n))}{" "}
          {send.unlimited
            ? s.quotaUnlimited
            : s.quota(
                formatCount(send.used),
                formatCount(send.used + n),
                formatCount(send.quota),
              )}
        </p>
        {blocked && (
          <InlineAlert tone={dirty ? "info" : "warn"} live="status">
            {blocked}
          </InlineAlert>
        )}
        <div className="flex justify-end">
          <ConfirmDialog
            trigger={s.trigger}
            triggerVariant="primary"
            tone="primary"
            disabled={Boolean(blocked)}
            title={s.confirmTitle}
            description={
              <div className="grid gap-2">
                <p>{s.recipients(formatCount(n))}</p>
                <p>
                  {send.unlimited
                    ? s.quotaUnlimited
                    : s.quota(
                        formatCount(send.used),
                        formatCount(send.used + n),
                        formatCount(send.quota),
                      )}
                </p>
                <p className="font-medium text-crit">{s.irreversible}</p>
              </div>
            }
            confirmLabel={s.confirm}
            pendingLabel={s.sending}
            action={sendCampaignAction}
            fields={{ id: campaignId }}
          />
        </div>
      </div>
    </Card>
  );
}
