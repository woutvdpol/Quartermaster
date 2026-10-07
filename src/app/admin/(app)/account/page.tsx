import type { Metadata } from "next";
import { Card, ConfirmDialog, DateTime, PageHeader, StatusPill } from "@/components/admin/ui";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { listSessions } from "@/server/users";
import { getTenantInfo } from "../_system/tenant";
import { requireAccount } from "./_session";
import { revokeOtherSessionsAction, revokeSessionAction } from "./actions";
import { PasswordForm } from "./_components/PasswordForm";
import { ProfileForm } from "./_components/ProfileForm";
import { TwoFactorPanel } from "./_components/TwoFactorPanel";

export const metadata: Metadata = { title: "Your account" };

/** Rough "Browser on OS" label from a user agent string. */
function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "unknown system";
  return `${browser} on ${os}`;
}

export default async function AccountPage() {
  const { user, sessionId } = await requireAccount();
  const [sessions, timeZone] = await Promise.all([
    listSessions(user, sessionId),
    user.tenantId ? getTenantInfo(user.tenantId).then((t) => t.timezone) : Promise.resolve(undefined),
  ]);
  const now = new Date();
  const others = sessions.filter((s) => !s.current).length;

  return (
    <>
      <PageHeader crumb="Your account" title={user.name ?? user.email} actions={<StatusPill tone="mute">{user.role === "SUPERADMIN" ? "Platform admin" : "Shop owner"}</StatusPill>} />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5 lg:grid-cols-2">
        <Card title="Profile">
          <ProfileForm name={user.name ?? ""} email={user.email} />
        </Card>

        <Card title="Password">
          <PasswordForm minLength={MIN_PASSWORD_LENGTH} />
        </Card>

        <Card title="Two-factor authentication" className="lg:col-span-2">
          <TwoFactorPanel enabled={user.totpEnabled} />
        </Card>

        <Card
          title="Active sessions"
          className="lg:col-span-2"
          padded={false}
          aside={
            others > 0 ? (
              <ConfirmDialog
                trigger="Sign out other sessions"
                triggerSize="sm"
                title="Sign out all other sessions?"
                description={`${others} other ${others === 1 ? "session is" : "sessions are"} signed out. This device stays signed in.`}
                confirmLabel="Sign out others"
                action={revokeOtherSessionsAction}
              />
            ) : undefined
          }
        >
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
                <div className="grid gap-0.5">
                  <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                    {deviceLabel(s.userAgent)}
                    {s.current && <StatusPill tone="ok">This device</StatusPill>}
                  </p>
                  <p className="text-xs text-muted">
                    {s.ip ? <span className="font-mono">{s.ip}</span> : "IP unknown"} · signed in <DateTime value={s.createdAt} timeZone={timeZone} /> · last active{" "}
                    <DateTime value={s.lastSeenAt} format="relative" now={now} timeZone={timeZone} />
                  </p>
                </div>
                {!s.current && (
                  <ConfirmDialog
                    trigger="Sign out"
                    triggerSize="sm"
                    triggerVariant="secondary"
                    title="Sign out this session?"
                    description={`${deviceLabel(s.userAgent)}${s.ip ? ` (${s.ip})` : ""} must sign in again.`}
                    confirmLabel="Sign out"
                    action={revokeSessionAction}
                    fields={{ id: s.id }}
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
