import type { Metadata } from "next";
import Link from "next/link";
import { Card, ConfirmDialog, DataTable, DateTime, EmptyState, PageHeader, StatusPill, type Column } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { listStaff, type StaffMember } from "@/server/users";
import { getTenantInfo } from "../_system/tenant";
import { disableUserAction, enableUserAction, resetTwoFactorAction } from "./actions";
import { InviteForm } from "./_components/InviteForm";
import { ResendInviteButton } from "./_components/ResendInviteButton";

export const metadata: Metadata = { title: "Users" };

function statusOf(u: StaffMember) {
  if (u.disabledAt) return <StatusPill tone="crit">Disabled</StatusPill>;
  if (u.invitePending) return <StatusPill tone="warn">Invite pending</StatusPill>;
  return <StatusPill tone="ok">Active</StatusPill>;
}

export default async function UsersPage() {
  const ctx = await requireStaffContext();
  const isSuper = ctx.actor.role === "SUPERADMIN";
  const [staff, tenant] = await Promise.all([listStaff(ctx), getTenantInfo(ctx.tenantId)]);
  const now = new Date();

  const columns: Column<StaffMember>[] = [
    {
      key: "user",
      header: "User",
      cell: (u) => (
        <span className="grid">
          <span className="font-medium text-ink">
            {u.name ?? u.email}
            {u.id === ctx.actor.id && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}
          </span>
          {u.name && <span className="text-xs text-muted">{u.email}</span>}
        </span>
      ),
    },
    { key: "role", header: "Role", hideBelow: "md", cell: () => <span className="text-ink-2">Owner</span> },
    { key: "status", header: "Status", cell: statusOf },
    {
      key: "2fa",
      header: "2FA",
      hideBelow: "sm",
      cell: (u) => (u.totpEnabled ? <StatusPill tone="ok">On</StatusPill> : <StatusPill tone="mute">Off</StatusPill>),
    },
    {
      key: "lastLogin",
      header: "Last sign-in",
      hideBelow: "md",
      cell: (u) => (u.lastLoginAt ? <DateTime value={u.lastLoginAt} format="relative" now={now} timeZone={tenant.timezone} /> : <span className="text-muted">Never</span>),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (u) => (
        <span className="flex flex-wrap justify-end gap-1.5">
          {u.invitePending && !u.disabledAt && <ResendInviteButton userId={u.id} email={u.email} timeZone={tenant.timezone} />}
          {isSuper && u.totpEnabled && (
            <ConfirmDialog
              trigger="Reset 2FA"
              triggerSize="sm"
              triggerVariant="secondary"
              title={`Reset two-factor authentication for ${u.email}?`}
              description="Their authenticator and recovery codes are removed and they are signed out. They can sign in with only their password and set up 2FA again. Use this when they lost their device."
              confirmLabel="Reset 2FA"
              action={resetTwoFactorAction}
              fields={{ id: u.id }}
            />
          )}
          {u.id !== ctx.actor.id &&
            (u.disabledAt ? (
              <ConfirmDialog
                trigger="Enable"
                triggerSize="sm"
                tone="primary"
                title={`Enable ${u.email}?`}
                description="They can sign in to the admin again."
                confirmLabel="Enable"
                action={enableUserAction}
                fields={{ id: u.id }}
              />
            ) : (
              <ConfirmDialog
                trigger="Disable"
                triggerSize="sm"
                title={`Disable ${u.email}?`}
                description="They are signed out everywhere and cannot sign in until you enable the account again. Unused invite or reset links stop working."
                confirmLabel="Disable"
                action={disableUserAction}
                fields={{ id: u.id }}
              />
            ))}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader crumb="System" title="Users" actions={<Link href="/admin/account" className="text-[13px] text-accent underline-offset-2 hover:underline">Your account & security</Link>} />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-2">
          <DataTable
            caption="Shop owners"
            columns={columns}
            rows={staff}
            rowKey={(u) => u.id}
            rowLabel={(u) => u.email}
            empty={<EmptyState compact title="No owners yet" body="Invite the first shop owner with the form." />}
          />
          <p className="text-xs text-muted">
            Lists the owner accounts of {tenant.name}. Quartermaster platform admins are not shown here.
          </p>
        </div>
        <Card title="Invite an owner">
          <InviteForm timeZone={tenant.timezone} />
        </Card>
      </div>
    </>
  );
}
