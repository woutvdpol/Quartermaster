import type { Metadata } from "next";
import { Suspense } from "react";
import { accountCopy } from "@/components/shop/account/_copy";
import { AccountShell, Panel } from "@/components/shop/account/AccountShell";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { EmailForm, PasswordForm, ProfileForm } from "@/components/shop/account/ProfileForms";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { requireShopCustomer } from "@/server/customer-auth";
import { changeEmailAction, changePasswordAction, updateProfileAction } from "../actions";

const t = accountCopy.profile;

export const metadata: Metadata = { title: t.title, robots: { index: false, follow: false } };

export default function ProfilePage() {
  return (
    <AccountShell active="profile" title={t.title}>
      <Suspense fallback={<FormSkeleton fields={4} />}>
        <Profile />
      </Suspense>
    </AccountShell>
  );
}

async function Profile() {
  const c = await requireShopCustomer("/account/profile");
  return (
    <div className="grid gap-6">
      <Panel title={t.details}>
        <ProfileForm action={updateProfileAction} name={c.user.name ?? ""} phone={c.customer.phone ?? ""} />
      </Panel>
      <Panel title={t.emailTitle}>
        <EmailForm action={changeEmailAction} email={c.user.email} />
      </Panel>
      <Panel title={t.passwordTitle}>
        <PasswordForm action={changePasswordAction} email={c.user.email} minPasswordLength={MIN_PASSWORD_LENGTH} />
      </Panel>
    </div>
  );
}
