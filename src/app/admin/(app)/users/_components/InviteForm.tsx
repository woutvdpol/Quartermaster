"use client";

import { useRef } from "react";
import { ActionMessage, Button, DateTime, InlineAlert, TextInput } from "@/components/admin/ui";
import { CopyField, PendingButton, useKeepForm } from "../../_system/client";
import { inviteOwnerAction } from "../actions";

/** Invite a shop owner by e-mail. The invite link is shown once, because mail may not be wired up yet. */
export function InviteForm({ timeZone }: { timeZone: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const { state, pending, error, onSubmit } = useKeepForm(inviteOwnerAction, { onSuccess: () => formRef.current?.reset() });
  const invite = state?.ok ? state.data : undefined;

  return (
    <div className="grid gap-3">
      <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-3">
        <ActionMessage state={state} showSuccess={false} />
        <TextInput label="E-mail" name="email" type="email" autoComplete="off" required maxLength={254} error={error("email")} />
        <TextInput label="Name" name="name" showOptional maxLength={120} error={error("name")} />
        <div>
          <PendingButton pending={pending} pendingLabel="Inviting…">
            Create invite
          </PendingButton>
        </div>
      </form>
      {invite && <InviteLinkNotice link={invite.link} email={invite.email} expiresAt={invite.expiresAt} timeZone={timeZone} />}
    </div>
  );
}

export function InviteLinkNotice({
  link,
  email,
  expiresAt,
  timeZone,
  onDismiss,
}: {
  link: string;
  email?: string;
  expiresAt: string;
  timeZone: string;
  onDismiss?: () => void;
}) {
  return (
    <InlineAlert
      tone="ok"
      live="status"
      title={email ? `Invite ready for ${email}` : "New invite link ready"}
      action={onDismiss && <Button size="sm" variant="ghost" onClick={onDismiss}>Done</Button>}
    >
      <div className="grid gap-2">
        <p>
          Invite e-mails may not be sent automatically yet. Copy this link and send it to the person yourself. It is shown only
          once, works once, and expires <DateTime value={expiresAt} timeZone={timeZone} />.
        </p>
        <CopyField label="Invite link" value={link} copiedMessage="Invite link copied." />
      </div>
    </InlineAlert>
  );
}
