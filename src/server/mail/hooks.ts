import "server-only";
import { encrypt } from "@/server/auth/encryption";
import { setOwnerInviteNotifier, type OwnerInviteNotice } from "@/server/users";
import { queueMail } from "./queue";

/*
 * Registers the mail senders for service hooks that live outside the mail module. Importing this
 * module has the side effect of registering them (idempotent), so it can simply be imported from
 * any entry point that may trigger the hook:
 *
 *   import "@/server/mail/hooks";
 *
 * It is imported by src/server/mail/index.ts (so any Next.js code that uses the mail API has it),
 * and should also be imported by the code paths that invite owners without touching the mail API:
 * src/app/admin/(app)/users/actions.ts and the platform "create tenant" action. The worker never
 * invites owners, but importing it there is harmless.
 *
 * Why not in instrumentation.ts: Next compiles instrumentation into its own bundle, so a module-level
 * notifier set there is not guaranteed to be the same module instance the route bundles use.
 */

export async function sendOwnerInviteMail(notice: OwnerInviteNotice): Promise<void> {
  await queueMail({
    tenantId: notice.tenantId,
    template: "owner-invite",
    // The raw token is encrypted in the job payload; the builder re-checks it is still the live one.
    props: { userId: notice.userId, tokenEnc: encrypt(notice.token), invitedBy: notice.invitedBy.email },
    to: notice.email,
  });
}

/** Idempotent: re-registering just replaces the notifier with the same function. */
export function registerMailHooks(): void {
  setOwnerInviteNotifier(sendOwnerInviteMail);
}

registerMailHooks();
