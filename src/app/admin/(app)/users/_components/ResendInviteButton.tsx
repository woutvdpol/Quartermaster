"use client";

import { useState, useTransition } from "react";
import { Button, Drawer, toast } from "@/components/admin/ui";
import { resendInviteAction, type InviteData } from "../actions";
import { InviteLinkNotice } from "./InviteForm";

/** Creates a new invite link (voids the old one) and shows it once in a side panel. */
export function ResendInviteButton({ userId, email, timeZone }: { userId: string; email: string; timeZone: string }) {
  const [pending, start] = useTransition();
  const [invite, setInvite] = useState<InviteData | null>(null);
  return (
    <>
      <Button
        size="sm"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          start(async () => {
            const res = await resendInviteAction(userId);
            if (!res.ok) toast.crit(res.message ?? "Could not create a new invite.");
            else if (res.data) setInvite({ ...res.data, email });
          })
        }
      >
        {pending ? "Creating…" : "New invite link"}
      </Button>
      <Drawer open={invite !== null} onOpenChange={(o) => !o && setInvite(null)} title="Invite link" description={email}>
        {invite && <InviteLinkNotice link={invite.link} email={invite.email} expiresAt={invite.expiresAt} timeZone={timeZone} onDismiss={() => setInvite(null)} />}
      </Drawer>
    </>
  );
}
