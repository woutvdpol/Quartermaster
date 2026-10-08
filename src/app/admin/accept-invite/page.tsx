import type { Metadata } from "next";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { peekDealerInvite } from "@/server/onboarding/invite";
import { getRequestTenant } from "@/server/tenant";
import { AuthCard } from "../login/AuthCard";
import { copy } from "./_copy";
import { AcceptInviteForm, InvalidInvite } from "./AcceptInviteForm";

export const metadata: Metadata = { title: copy.title, referrer: "no-referrer" };

/**
 * Public: `/admin/accept-invite?token=…` from the "your shop is approved" mail, on the shop's own host.
 * The page only peeks at the token (to show the account's e-mail or an early "expired" message); the
 * action re-validates and claims it atomically.
 */
export default async function AcceptInvitePage({ searchParams }: PageProps<"/admin/accept-invite">) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw.trim() : "";
  const tenant = await getRequestTenant();
  const invite = tenant && token ? await peekDealerInvite(token, tenant.id) : null;
  return (
    <AuthCard title={copy.title} subtitle={tenant ? `${tenant.name} · ${copy.subtitle}` : copy.subtitle}>
      {invite ? <AcceptInviteForm token={token} minLength={MIN_PASSWORD_LENGTH} email={invite.email} /> : <InvalidInvite />}
    </AuthCard>
  );
}
