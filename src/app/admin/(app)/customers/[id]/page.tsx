import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import {
  Card,
  ConfirmDialog,
  DataTable,
  DateTime,
  FulfillmentStatusPill,
  InlineAlert,
  KpiCard,
  Money,
  PageHeader,
  PaymentStatusPill,
  StatusPill,
  formatDate,
  formatMoney,
  type Column,
} from "@/components/admin/ui";
import { requireStaffContext, ServiceError } from "@/server/context";
import { getCustomer, type CustomerDetail } from "@/server/customers";
import { addressLines } from "../../orders/_lib/labels";
import { requireTenantDisplay } from "@/server/tenant-display";
import { customerCopy as t, customersCopy } from "../_copy";
import { anonymizeCustomerAction } from "./actions";
import { ProfileForm } from "./_components/ProfileForm";

type OrderRow = CustomerDetail["orders"][number];

const load = cache(async (id: string) => {
  const ctx = await requireStaffContext();
  try {
    const [customer, display] = await Promise.all([getCustomer(ctx, id), requireTenantDisplay(ctx.tenantId)]);
    return { customer, display };
  } catch (e) {
    if (e instanceof ServiceError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
});

function displayName(c: CustomerDetail) {
  if (c.anonymized) return customersCopy.anonymized;
  return c.name || c.email;
}

export async function generateMetadata({ params }: PageProps<"/admin/customers/[id]">): Promise<Metadata> {
  const { customer } = await load((await params).id);
  return { title: displayName(customer) };
}

export default async function CustomerPage({ params }: PageProps<"/admin/customers/[id]">) {
  const { id } = await params;
  const { customer: c, display } = await load(id);
  const tz = display.timeZone;
  // Revenue is summed over PAID orders; they share the shop currency in practice.
  const currency = c.orders[0]?.currency ?? display.currency;

  const orderColumns: Column<OrderRow>[] = [
    {
      key: "number",
      header: t.orders.number,
      cell: (o) => (
        <Link href={`/admin/orders/${o.id}`} className="font-mono font-medium text-ink underline-offset-2 hover:underline">
          #{o.number}
        </Link>
      ),
    },
    {
      key: "placed",
      header: t.orders.placed,
      cell: (o) => (
        <span className="text-muted">
          <DateTime value={o.placedAt} format="date" timeZone={tz} />
          {o.archivedAt && <span className="ml-1.5 text-xs">· {t.orders.archived}</span>}
        </span>
      ),
    },
    {
      key: "payment",
      header: t.orders.payment,
      cell: (o) => <PaymentStatusPill status={o.paymentStatus} />,
    },
    {
      key: "fulfillment",
      header: t.orders.fulfillment,
      hideBelow: "sm",
      cell: (o) => <FulfillmentStatusPill status={o.fulfillmentStatus} />,
    },
    {
      key: "total",
      header: t.orders.total,
      numeric: true,
      cell: (o) => <Money amount={o.total} currency={o.currency} mono />,
    },
  ];

  return (
    <>
      <PageHeader
        crumb={
          <Link href="/admin/customers" className="hover:text-ink hover:underline">
            {t.crumb}
          </Link>
        }
        title={displayName(c)}
        actions={
          c.anonymized ? (
            <StatusPill tone="mute">{customersCopy.anonymized}</StatusPill>
          ) : (
            <StatusPill tone={c.registered ? "info" : "mute"}>
              {c.registered ? customersCopy.registered : customersCopy.guest}
            </StatusPill>
          )
        }
      />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        {c.anonymized && <InlineAlert tone="info">{t.anonymizedBanner}</InlineAlert>}

        <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label={t.stats.orders}
            value={String(c.orderCount)}
            note={`${c.paidOrderCount} ${t.stats.paidOrders.toLowerCase()}`}
          />
          <KpiCard label={t.stats.revenue} value={formatMoney(c.paidRevenue, currency)} note={t.stats.revenueNote} />
          <KpiCard label={t.stats.lastOrder} value={c.lastOrderAt ? formatDate(c.lastOrderAt, "date", tz) : "—"} />
          <KpiCard
            label={t.stats.since}
            value={formatDate(c.createdAt, "date", tz)}
            note={`${t.stats.wishlist}: ${c.wishlistCount}`}
          />
        </section>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <section aria-labelledby="orders-title" className="min-w-0">
            <h2 id="orders-title" className="type-label px-0.5 pb-2 text-sm text-ink">
              {t.orders.title}
            </h2>
            <DataTable
              caption={t.orders.caption}
              columns={orderColumns}
              rows={c.orders}
              rowKey={(o) => o.id}
              stickyHeader={false}
              empty={<p className="px-3 py-4 text-[13px] text-muted">{t.orders.none}</p>}
            />
          </section>

          <div className="grid min-w-0 gap-4">
            <Card title={t.profile.title}>
              <ProfileForm
                customer={{
                  id: c.id,
                  firstName: c.firstName,
                  lastName: c.lastName,
                  email: c.email,
                  phone: c.phone,
                  notes: c.notes,
                  registered: c.registered,
                }}
                disabled={c.anonymized}
              />
            </Card>

            <Card title={t.addresses.title}>
              {c.addresses.length === 0 ? (
                <p className="text-[13px] text-muted">{t.addresses.none}</p>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {c.addresses.map((a) => (
                    <li key={a.id} className="grid content-start gap-1 rounded-control border border-line p-2.5 text-[13px]">
                      <div className="flex flex-wrap gap-1.5">
                        <StatusPill tone="mute">{a.type === "BILLING" ? t.addresses.billing : t.addresses.shipping}</StatusPill>
                        {a.isDefault && <StatusPill tone="info">{t.addresses.default}</StatusPill>}
                      </div>
                      <address className="leading-relaxed not-italic">
                        {addressLines(a).map((l, i) => (
                          <span key={i} className="block">
                            {l}
                          </span>
                        ))}
                        {a.phone && <span className="block text-muted">{a.phone}</span>}
                      </address>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {!c.anonymized && (
              <Card title={t.anonymize.title}>
                <div className="grid gap-3 text-[13px] text-ink-2">
                  <p>{t.anonymize.intro}</p>
                  <div>
                    <ConfirmDialog
                      trigger={t.anonymize.trigger}
                      title={t.anonymize.dialogTitle}
                      confirmLabel={t.anonymize.confirm}
                      tone="danger"
                      action={anonymizeCustomerAction}
                      fields={{ id: c.id }}
                      description={
                        <div className="grid gap-2">
                          <InlineAlert tone="crit" title={t.anonymize.irreversible}>
                            {displayName(c)} · {c.orderCount} {c.orderCount === 1 ? "order" : "orders"}
                          </InlineAlert>
                          <p>{t.anonymize.kept}</p>
                          <p>{t.anonymize.scrubbed}</p>
                          <p>{t.anonymize.deleted}</p>
                          <p className="text-muted">{t.anonymize.notCovered}</p>
                        </div>
                      }
                    />
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
