import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, ConfirmDialog, DateTime, KeyValue, PageHeader, StatusPill } from "@/components/admin/ui";
import { queryPlatformAuditLog } from "@/server/auditlog";
import { ServiceError } from "@/server/context";
import { getTenant, listTenants, requirePlatformContext } from "@/server/platform";
import { toRows } from "../../audit-log/_data";
import { AuditList } from "../../audit-log/_components/AuditList";
import { getSettings } from "@/server/settings";
import { addDomainAction, allowNetworkAction, removeFromNetworkAction, loadMorePlatformAuditAction, removeDomainAction, setPrimaryDomainAction, setTenantStatusAction, updateTenantAction } from "../actions";
import { AddDomainForm } from "../_components/AddDomainForm";
import { TenantForm } from "../_components/TenantForm";
import { STATUS_EFFECT, STATUS_LABEL, STATUS_TONE, timeZoneOptions, type TenantStatusValue } from "../_shared";

export const metadata: Metadata = { title: "Platform · Shop" };

const STATUSES: TenantStatusValue[] = ["ACTIVE", "SUSPENDED", "ARCHIVED"];
const VERB: Record<TenantStatusValue, string> = { ACTIVE: "Reactivate", SUSPENDED: "Suspend", ARCHIVED: "Archive" };

async function loadTenant(ctx: Awaited<ReturnType<typeof requirePlatformContext>>, id: string) {
  try {
    return await getTenant(ctx, id);
  } catch (err) {
    if (err instanceof ServiceError && (err.code === "NOT_FOUND" || err.code === "INVALID")) return null;
    throw err;
  }
}

export default async function PlatformTenantPage({ params }: PageProps<"/admin/platform/[tenantId]">) {
  const { tenantId } = await params;
  const ctx = await requirePlatformContext();
  const tenant = await loadTenant(ctx, tenantId);
  if (!tenant) notFound();

  const [stats, audit, platformSettings] = await Promise.all([
    listTenants(ctx, { search: tenant.slug }).then((list) => list.find((t) => t.id === tenant.id) ?? null),
    queryPlatformAuditLog(ctx, { tenantId: tenant.id, limit: 25 }),
    getSettings(tenant.id, "platform"),
  ]);
  const currencyLocked = (stats?.productCount ?? 0) > 0;
  const status = tenant.status as TenantStatusValue;

  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link href="/admin/platform" className="hover:text-ink hover:underline">
              Platform
            </Link>{" "}
            · Shop
          </>
        }
        title={tenant.name}
        actions={<StatusPill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusPill>}
      />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5 lg:grid-cols-2">
        <Card title="Shop details">
          <TenantForm
            tenant={{ name: tenant.name, slug: tenant.slug, currency: tenant.currency, timezone: tenant.timezone }}
            timeZones={timeZoneOptions()}
            currencyLocked={currencyLocked}
            action={updateTenantAction.bind(null, tenant.id)}
          />
        </Card>

        <div className="grid content-start gap-4">
          <Card title="Overview">
            <KeyValue
              items={[
                { label: "Created", value: <DateTime value={tenant.createdAt} format="date" /> },
                { label: "Products (active / all)", value: stats ? `${stats.activeProductCount} / ${stats.productCount}` : "—", mono: true },
                { label: "Orders, last 30 days", value: stats?.orders30d ?? "—", mono: true },
                { label: "Owners", value: stats?.ownerCount ?? "—", mono: true },
                { label: "Last activity", value: stats?.lastActivityAt ? <DateTime value={stats.lastActivityAt} /> : "—" },
              ]}
            />
            <p className="mt-2 text-xs text-muted">
              Plan and limits live in the shop&apos;s settings. Switch to this shop in the sidebar, then open{" "}
              <Link href="/admin/settings/platform" className="text-accent underline-offset-2 hover:underline">
                Settings → Platform
              </Link>
              .
            </p>
          </Card>

          <Card title="Quartermaster network" aside={tenant.networkOptIn ? <StatusPill tone="ok">Listed</StatusPill> : <StatusPill tone="mute">Not listed</StatusPill>}>
            <p className="mb-3 text-[13px] text-ink-2">
              {tenant.networkOptIn
                ? <>The owner shows this shop&apos;s stock in the network{tenant.networkJoinedAt ? <> since <DateTime value={tenant.networkJoinedAt} format="date" /></> : null}.</>
                : platformSettings.networkBlocked
                  ? "Removed from the network by Quartermaster. The owner cannot join again until you allow it."
                  : "The owner has not opted in to the network."}
            </p>
            <div className="flex flex-wrap gap-2">
              {tenant.networkOptIn || !platformSettings.networkBlocked ? (
                <ConfirmDialog
                  trigger="Remove from network"
                  triggerSize="sm"
                  tone="danger"
                  title={`Remove “${tenant.name}” from the network?`}
                  description="Its stock disappears from the network search straight away, and the owner cannot opt in again until you allow it. The shop itself is not affected."
                  confirmLabel="Remove from network"
                  action={removeFromNetworkAction}
                  fields={{ tenantId: tenant.id }}
                />
              ) : (
                <ConfirmDialog
                  trigger="Allow again"
                  triggerSize="sm"
                  tone="primary"
                  title={`Allow “${tenant.name}” to join the network again?`}
                  description="The owner can then switch the network on in Settings → General. The shop is not listed until they do."
                  confirmLabel="Allow again"
                  action={allowNetworkAction}
                  fields={{ tenantId: tenant.id }}
                />
              )}
            </div>
          </Card>

          <Card title="Status">
            <p className="mb-3 text-[13px] text-ink-2">{STATUS_EFFECT[status]}</p>
            <div className="flex flex-wrap gap-2">
              {STATUSES.filter((s) => s !== status).map((s) => (
                <ConfirmDialog
                  key={s}
                  trigger={VERB[s]}
                  triggerSize="sm"
                  tone={s === "ACTIVE" ? "primary" : "danger"}
                  title={`${VERB[s]} “${tenant.name}”?`}
                  description={STATUS_EFFECT[s]}
                  confirmLabel={VERB[s]}
                  action={setTenantStatusAction}
                  fields={{ tenantId: tenant.id, status: s }}
                />
              ))}
            </div>
          </Card>
        </div>

        <Card title="Domains" aside={`${tenant.domains.length} ${tenant.domains.length === 1 ? "domain" : "domains"}`} className="lg:col-span-2">
          <div className="grid gap-4">
            <ul className="divide-y divide-line rounded-control border border-line">
              {tenant.domains.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px]">{d.host}</span>
                    {d.isPrimary && <StatusPill tone="ok">Primary</StatusPill>}
                  </span>
                  {!d.isPrimary && (
                    <span className="flex gap-1.5">
                      <ConfirmDialog
                        trigger="Make primary"
                        triggerSize="sm"
                        tone="primary"
                        title={`Make ${d.host} the primary domain?`}
                        description="Invite, mail and payment links will use this host."
                        confirmLabel="Make primary"
                        action={setPrimaryDomainAction}
                        fields={{ domainId: d.id }}
                      />
                      <ConfirmDialog
                        trigger="Remove"
                        triggerSize="sm"
                        triggerVariant="ghost"
                        title={`Remove ${d.host}?`}
                        description="The shop stops answering on this host straight away."
                        confirmLabel="Remove domain"
                        action={removeDomainAction}
                        fields={{ domainId: d.id }}
                      />
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <AddDomainForm action={addDomainAction.bind(null, tenant.id)} />
          </div>
        </Card>

        <section className="grid min-w-0 gap-2 lg:col-span-2" aria-labelledby="tenant-audit">
          <h2 id="tenant-audit" className="type-label text-sm text-ink">
            Recent activity
          </h2>
          <AuditList
            initialRows={toRows(audit.items, true)}
            initialCursor={audit.nextCursor}
            filters={{}}
            loadMore={loadMorePlatformAuditAction.bind(null, { scope: "all", tenantId: tenant.id })}
            timeZone={tenant.timezone}
            emptyBody="Nothing has been logged for this shop yet."
          />
        </section>
      </div>
    </>
  );
}
