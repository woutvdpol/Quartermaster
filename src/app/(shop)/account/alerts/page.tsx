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
import { AlertRow } from "./AlertRow";

export const metadata: Metadata = { title: "Alerts", robots: { index: false, follow: false } };

export default function AccountAlertsPage() {
  return (
    <AccountShell active="alerts" title="Alerts">
      <Suspense fallback={<FormSkeleton fields={3} />}>
        <Alerts />
      </Suspense>
    </AccountShell>
  );
}

async function Alerts() {
  const c = await requireShopCustomer("/account/alerts");
  const owner = { tenantId: c.tenant.id, customerId: c.customer.id };
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
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: c.tenant.timezone ?? "Europe/Amsterdam" });
  const currency = new Intl.NumberFormat("en-GB", { style: "currency", currency: c.tenant.currency ?? "EUR", maximumFractionDigits: 0 });
  const money = (minor: number) => currency.format(minor / 100);
  if (!rows.length) {
    return (
      <div className="grid gap-4">
        {pushSettings}
        <EmptyState
          title="No alerts yet"
          action={
            <ButtonLink href="/shop" variant="primary">
              Browse the shop
            </ButtonLink>
          }
        >
          Use “Save search” on any search, or “Notify me” on a sold item, and we&apos;ll email you when something matching arrives.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      {pushSettings}
      <p className="text-sm text-shop-muted">
        We email you when new items match. You can have up to {MAX_ACTIVE_PER_EMAIL} active alerts. Wishlist items notify you automatically
        when they become available again or get cheaper.
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

