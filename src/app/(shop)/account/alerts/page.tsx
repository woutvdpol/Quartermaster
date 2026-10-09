import type { Metadata } from "next";
import { ButtonLink } from "@/components/shop/ui/Button";
import { Suspense } from "react";
import { AccountShell } from "@/components/shop/account/AccountShell";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { EmptyState } from "@/components/shop/ui/EmptyState";
import { listCustomerSearches, MAX_ACTIVE_PER_EMAIL, summarizeDescription } from "@/server/alerts";
import { requireShopCustomer } from "@/server/customer-auth";
import { getPushPrefs, vapidPublicKey, MAX_PER_DAY_OPTIONS, QUIET_HOUR_PRESETS } from "@/server/push";
import { PushSettings } from "@/components/shop/push/PushSettings";
import { accountCopies } from "@/components/shop/account/_copy";
import { alertsCopies } from "@/components/shop/alerts/_copy";
import { INTL_LOCALE } from "@/lib/i18n/shop-locales";
import { getRequestLocale, shopCopy } from "@/server/i18n/locale";
import { AlertRow } from "./AlertRow";

export async function generateMetadata(): Promise<Metadata> {
  const title = (await shopCopy(accountCopies)).account.nav.alerts;
  return { title, robots: { index: false, follow: false } };
}

export default async function AccountAlertsPage() {
  const title = (await shopCopy(accountCopies)).account.nav.alerts;
  return (
    <AccountShell active="alerts" title={title}>
      <Suspense fallback={<FormSkeleton fields={3} />}>
        <Alerts />
      </Suspense>
    </AccountShell>
  );
}

async function Alerts() {
  const c = await requireShopCustomer("/account/alerts");
  const owner = { tenantId: c.tenant.id, customerId: c.customer.id };
  const locale = await getRequestLocale();
  const t = (await shopCopy(alertsCopies)).account;
  const [rows, push] = await Promise.all([listCustomerSearches(owner), getPushPrefs(owner)]);
  const publicKey = push.available ? vapidPublicKey() : null;
  // Web push (docs/push.md): only when the platform has VAPID keys.
  const pushSettings = publicKey ? (
    <PushSettings
      initial={{
        publicKey,
        devices: push.devices,
        quietStart: push.quietStart,
        quietEnd: push.quietEnd,
        maxPerDay: push.maxPerDay,
        wishlist: push.wishlist,
        reservation: push.reservation,
        quietPresets: QUIET_HOUR_PRESETS,
        maxOptions: MAX_PER_DAY_OPTIONS,
      }}
    />
  ) : null;
  const fmt = new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "medium", timeZone: c.tenant.timezone ?? "Europe/Amsterdam" });
  const currency = new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency: c.tenant.currency ?? "EUR", maximumFractionDigits: 0 });
  const money = (minor: number) => currency.format(minor / 100);
  if (!rows.length) {
    return (
      <div className="grid gap-4">
        {pushSettings}
        <EmptyState
          title={t.emptyTitle}
          action={
            <ButtonLink href="/shop" variant="primary">
              {t.browse}
            </ButtonLink>
          }
        >
          {t.emptyBody}
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      {pushSettings}
      <p className="text-sm text-shop-muted">
        {t.intro(MAX_ACTIVE_PER_EMAIL)}
      </p>
      <ul className="grid gap-4">
        {rows.map((r) => (
          <AlertRow
            key={r.id}
            pushAvailable={!!publicKey}
            alert={{
              id: r.id,
              name: r.name,
              frequency: r.frequency,
              push: r.push && !!publicKey,
              active: r.status === "active",
              summary: summarizeDescription(r.description, money),
              href: r.description.href,
              lastNotified: r.lastNotifiedAt ? fmt.format(r.lastNotifiedAt) : null,
            }}
          />
        ))}
      </ul>
    </div>
  );
}

