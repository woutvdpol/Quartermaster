import type { Metadata } from "next";
import Link from "next/link";
import { Card, ConfirmDialog, DateTime, EmptyState, InlineAlert, KeyValue, PageHeader, StatusPill } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { getMollieStatus, listMollieMethods, type MollieMethodInfo } from "@/server/payments/mollie-config";
import { loadErrorMessage } from "../_system/errors";
import { requireTenantDisplay } from "@/server/tenant-display";
import { removeMollieKeyAction } from "./actions";
import { MethodsForm, type MethodRow } from "./_components/MethodsForm";
import { MollieKeyForm } from "./_components/MollieKeyForm";

export const metadata: Metadata = { title: "Payment methods" };

function limits(m: MollieMethodInfo): string | null {
  const min = m.minimumAmount ? `${m.minimumAmount.currency} ${m.minimumAmount.value}` : null;
  const max = m.maximumAmount ? `${m.maximumAmount.currency} ${m.maximumAmount.value}` : null;
  if (min && max) return `${min} – ${max}`;
  if (min) return `from ${min}`;
  if (max) return `up to ${max}`;
  return null;
}

export default async function PaymentMethodsPage() {
  const ctx = await requireStaffContext();
  const [status, tenant] = await Promise.all([getMollieStatus(ctx), requireTenantDisplay(ctx.tenantId)]);

  let methods: MollieMethodInfo[] | null = null;
  let methodsError: string | null = null;
  if (status.configured) {
    try {
      methods = await listMollieMethods(ctx);
    } catch (err) {
      methodsError = loadErrorMessage(err);
    }
  }

  const rows: MethodRow[] = (methods ?? []).map((m) => ({ id: m.id, description: m.description, enabled: m.enabled, limits: limits(m) }));

  return (
    <>
      <PageHeader crumb="System" title="Payment methods" />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card
          title="Mollie"
          aside={
            status.configured ? (
              <StatusPill tone={status.mode === "live" ? "ok" : "warn"}>Connected · {status.mode === "live" ? "live" : "test"}</StatusPill>
            ) : (
              <StatusPill tone="crit">Not connected</StatusPill>
            )
          }
        >
          <div className="grid gap-4">
            <p className="text-[13px] text-ink-2">
              Quartermaster takes payments through Mollie only (iDEAL, Bancontact, cards, PayPal and more). Mollie decides when an order is paid.
            </p>
            {status.configured ? (
              <>
                {status.mode === "test" && (
                  <InlineAlert tone="warn" title="Test mode">
                    Customers cannot really pay. Replace the key with a live key before you open the shop.
                  </InlineAlert>
                )}
                <KeyValue
                  items={[
                    { label: "API key", value: status.maskedKey ?? "—", mono: true },
                    { label: "Mode", value: status.mode === "live" ? "Live" : "Test" },
                    {
                      label: "Verified",
                      value: status.verifiedAt ? <DateTime value={status.verifiedAt} timeZone={tenant.timeZone} /> : "—",
                    },
                  ]}
                />
                <details className="group rounded-control border border-line">
                  <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium">Replace API key</summary>
                  <div className="border-t border-line p-3">
                    <MollieKeyForm replacing />
                  </div>
                </details>
                <div className="flex justify-end">
                  <ConfirmDialog
                    trigger="Disconnect Mollie"
                    triggerSize="sm"
                    title="Disconnect Mollie?"
                    description="The stored API key is removed. Checkout cannot start payments until you connect a key again. Your method selection is kept."
                    confirmLabel="Disconnect"
                    action={removeMollieKeyAction}
                  />
                </div>
              </>
            ) : (
              <MollieKeyForm replacing={false} />
            )}
          </div>
        </Card>

        <div className="grid content-start gap-4">
          <Card title="Methods at checkout" aside={status.configured && methods ? `${methods.length} active in Mollie` : undefined}>
            {!status.configured ? (
              <EmptyState compact title="Connect Mollie first" body="The methods you activated in your Mollie dashboard appear here once a key is connected." />
            ) : methodsError ? (
              <InlineAlert tone="crit" title="Could not load methods from Mollie">
                {methodsError}
              </InlineAlert>
            ) : rows.length === 0 ? (
              <EmptyState
                compact
                title="No methods active in Mollie"
                body="Activate payment methods (for example iDEAL) in your Mollie dashboard, then reload this page."
              />
            ) : (
              <MethodsForm methods={rows} allEnabled={status.enabledMethods.length === 0} />
            )}
          </Card>

          <Card title="Currency">
            <p className="text-[13px] text-ink-2">
              Customers always pay in the shop currency, <b className="font-mono font-medium text-ink">{tenant.currency}</b>. Extra display currencies (
              <Link href="/admin/settings/general" className="text-accent underline-offset-2 hover:underline">
                Settings → General
              </Link>
              ) only change how prices are shown. Some methods only accept certain currencies or amounts; Mollie hides those at checkout automatically.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
