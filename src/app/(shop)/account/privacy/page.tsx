import type { Metadata } from "next";
import { Suspense } from "react";
import { accountCopy } from "@/components/shop/account/_copy";
import { AccountShell, Panel } from "@/components/shop/account/AccountShell";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { DeleteAccount, NewsletterForm } from "@/components/shop/account/PrivacyForms";
import { getNewsletterPreference, requireShopCustomer } from "@/server/customer-auth";
import { deleteAccountAction, newsletterPreferenceAction } from "../actions";

const t = accountCopy.privacy;

export const metadata: Metadata = { title: t.title, robots: { index: false, follow: false } };

export default function PrivacyPage() {
  return (
    <AccountShell active="privacy" title={t.title}>
      <Suspense fallback={<FormSkeleton fields={2} />}>
        <Privacy />
      </Suspense>
    </AccountShell>
  );
}

async function Privacy() {
  const c = await requireShopCustomer("/account/privacy");
  const pref = await getNewsletterPreference(c.tenant.id, c.user.email);
  return (
    <div className="grid gap-6">
      <Panel title={t.newsletterTitle}>
        {pref.enabled ? (
          <NewsletterForm action={newsletterPreferenceAction} status={pref.status} />
        ) : (
          <p className="text-sm text-shop-muted">{t.newsletterDisabled}</p>
        )}
      </Panel>
      <Panel title={t.deleteTitle}>
        <DeleteAccount action={deleteAccountAction} email={c.user.email} />
      </Panel>
    </div>
  );
}
