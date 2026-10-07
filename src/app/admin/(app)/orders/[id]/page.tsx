import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import {
  Card,
  ConfirmDialog,
  DataTable,
  DateTime,
  FulfillmentStatusPill,
  InlineAlert,
  KeyValue,
  Money,
  PageHeader,
  PaymentStatusPill,
  StatusPill,
  Textarea,
  Thumb,
  Timeline,
  Tooltip,
  WipBadge,
  buttonClasses,
  type Column,
} from "@/components/admin/ui";
import { requireStaffContext, ServiceError } from "@/server/context";
import { getOrder, type OrderDetail } from "@/server/orders/queries";
import { imageUrl } from "@/server/media/product-images";
import { orderCopy as t } from "../_copy";
import { addressLines, describeEvent, orderSteps, paymentMethodLabel } from "../_lib/labels";
import { requireTenantDisplay } from "@/server/tenant-display";
import { archiveOrderAction, cancelOrderAction, markPaidAction, unarchiveOrderAction } from "./actions";
import { FulfillmentForm } from "./_components/FulfillmentForm";
import { NoteForm } from "./_components/NoteForm";
import { StatusStepper } from "./_components/StatusStepper";

type Line = OrderDetail["lines"][number];
type PaymentRow = OrderDetail["payments"][number];

const load = cache(async (id: string) => {
  const ctx = await requireStaffContext();
  try {
    const [order, display] = await Promise.all([getOrder(ctx, id), requireTenantDisplay(ctx.tenantId)]);
    return { order, display };
  } catch (e) {
    if (e instanceof ServiceError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
});

export async function generateMetadata({ params }: PageProps<"/admin/orders/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { order } = await load(id);
  return { title: t.title(order.number) };
}

/** Oversold lines from `stock.oversold` events, with the product title from the line snapshot. */
function oversoldLines(order: OrderDetail) {
  const out: {
    key: string;
    title: string;
    ordered: number;
    available: number;
  }[] = [];
  for (const e of order.events) {
    if (e.type !== "stock.oversold" || !e.data || typeof e.data !== "object" || Array.isArray(e.data)) continue;
    const lines = (e.data as { lines?: unknown }).lines;
    if (!Array.isArray(lines)) continue;
    for (const raw of lines) {
      const l = raw as {
        productId?: string;
        ordered?: number;
        available?: number;
      };
      const line = order.lines.find((x) => x.productId === l.productId);
      out.push({
        key: `${e.id}-${l.productId}`,
        title: line ? `${line.title}${line.stockCode !== null ? ` (#${line.stockCode})` : ""}` : (l.productId ?? "?"),
        ordered: Number(l.ordered ?? 0),
        available: Number(l.available ?? 0),
      });
    }
  }
  return out;
}

function Address({ title, lines, empty }: { title: string; lines: string[] | null; empty: string }) {
  return (
    <div className="grid content-start gap-1">
      <h3 className="type-label text-[11px] text-muted">{title}</h3>
      {lines && lines.length ? (
        <address className="text-[13px] leading-relaxed not-italic">
          {lines.map((l, i) => (
            <span key={i} className="block">
              {l}
            </span>
          ))}
        </address>
      ) : (
        <p className="text-[13px] text-muted">{empty}</p>
      )}
    </div>
  );
}

export default async function OrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  const { id } = await params;
  const { order, display } = await load(id);
  const tz = display.timeZone;
  const cur = order.currency;

  const { steps, stopped } = orderSteps(order.paymentStatus, order.fulfillmentStatus);
  const method = paymentMethodLabel(order.paymentMethod);
  const oversold = oversoldLines(order);
  const paid = order.paymentStatus === "PAID";
  const settled = paid || order.paymentStatus === "REFUNDED" || order.paymentStatus === "PARTIALLY_REFUNDED";
  const canMarkPaid = order.paymentStatus === "PENDING" && !order.canceledAt;
  const canCancel = !settled && !order.finalizedAt && !order.canceledAt;
  const hidden = { id: order.id, customerId: order.customerId ?? "" };

  const lineColumns: Column<Line>[] = [
    {
      key: "product",
      header: t.lines.product,
      cell: (l) => (
        <div className="flex items-center gap-2.5">
          <Thumb src={l.imagePath ? imageUrl(l.imagePath) : undefined} alt="" size="sm" />
          <div className="min-w-0">
            {l.productId ? (
              <Link href={`/admin/inventory/${l.productId}`} className="text-ink underline-offset-2 hover:underline">
                {l.title}
              </Link>
            ) : (
              <span>{l.title}</span>
            )}
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              {l.sku && <span className="font-mono">{l.sku}</span>}
              {!l.productId && <span>{t.lines.productGone}</span>}
              {l.priceReconstructed && (
                <Tooltip content={t.lines.reconstructedHint}>
                  <button type="button" className="cursor-help">
                    <StatusPill tone="warn">{t.lines.reconstructed}</StatusPill>
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "stockCode",
      header: t.lines.stockCode,
      hideBelow: "sm",
      cell: (l) => <span className="font-mono">{l.stockCode ?? "—"}</span>,
    },
    {
      key: "qty",
      header: t.lines.qty,
      numeric: true,
      cell: (l) => <span className="font-mono">{l.quantity}</span>,
    },
    {
      key: "unit",
      header: t.lines.unit,
      numeric: true,
      hideBelow: "sm",
      cell: (l) => <Money amount={l.unitPrice} currency={cur} mono />,
    },
    {
      key: "total",
      header: t.lines.total,
      numeric: true,
      cell: (l) => <Money amount={l.lineTotal} currency={cur} mono />,
    },
  ];

  const paymentColumns: Column<PaymentRow>[] = [
    {
      key: "provider",
      header: t.payments.provider,
      cell: (p) => (p.provider === "MANUAL" ? t.payments.manual : t.payments.mollie),
    },
    {
      key: "method",
      header: t.payments.method,
      cell: (p) => paymentMethodLabel(p.method) ?? "—",
    },
    {
      key: "status",
      header: t.payments.status,
      cell: (p) => (
        <StatusPill
          tone={
            p.status === "PAID"
              ? "ok"
              : p.status === "FAILED"
                ? "crit"
                : p.status === "OPEN" || p.status === "PENDING"
                  ? "warn"
                  : "mute"
          }
        >
          {p.status.charAt(0) + p.status.slice(1).toLowerCase()}
        </StatusPill>
      ),
    },
    {
      key: "ref",
      header: t.payments.reference,
      hideBelow: "md",
      cell: (p) => <span className="font-mono text-xs">{p.providerPaymentId ?? "—"}</span>,
    },
    {
      key: "amount",
      header: t.payments.amount,
      numeric: true,
      cell: (p) => <Money amount={p.amount} currency={p.currency} mono />,
    },
    {
      key: "date",
      header: t.payments.date,
      align: "right",
      hideBelow: "sm",
      cell: (p) => (
        <DateTime
          value={p.paidAt ?? p.failedAt ?? p.canceledAt ?? p.expiredAt ?? p.createdAt}
          timeZone={tz}
          className="text-muted"
        />
      ),
    },
  ];

  const timeline = [...order.events].reverse().map((e) => {
    const d = describeEvent(e);
    return {
      id: e.id,
      title: d.title,
      body: d.detail,
      tone: d.tone,
      highlight: d.highlight,
      meta: (
        <>
          <DateTime value={e.createdAt} timeZone={tz} /> · {e.actor?.name ?? t.timeline.system}
        </>
      ),
    };
  });

  const shipLines = order.shippingAddress ? addressLines(order.shippingAddress) : null;
  const billLines = order.billingAddress ? addressLines(order.billingAddress) : null;
  const billingSame = shipLines && billLines && shipLines.join("|") === billLines.join("|");

  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link href="/admin/orders" className="hover:text-ink hover:underline">
              {t.crumb}
            </Link>{" "}
            › <span className="font-mono">#{order.number}</span>
          </>
        }
        title={t.title(order.number)}
        actions={
          <>
            <a href={`/admin/orders/${order.id}/packing-slip`} target="_blank" rel="noopener" className={buttonClasses()}>
              {t.actions.packingSlip}
            </a>
            <span className="inline-flex items-center gap-1.5">
              <button type="button" disabled className={buttonClasses()} aria-describedby="invoice-wip">
                {t.actions.invoice}
              </button>
              <span id="invoice-wip" className="sr-only">
                {t.actions.invoiceWip}
              </span>
              <WipBadge />
            </span>
            {canCancel && (
              <ConfirmDialog
                trigger={t.actions.cancel}
                title={t.actions.cancelTitle}
                description={t.actions.cancelBody}
                confirmLabel={t.actions.cancelConfirm}
                action={cancelOrderAction}
                fields={hidden}
              >
                <Textarea label={t.actions.cancelReason} name="reason" rows={2} maxLength={5000} />
              </ConfirmDialog>
            )}
            {order.archivedAt ? (
              <ConfirmDialog
                trigger={t.actions.unarchive}
                tone="primary"
                title={t.actions.unarchiveTitle}
                description={t.actions.unarchiveBody}
                confirmLabel={t.actions.unarchive}
                action={unarchiveOrderAction}
                fields={hidden}
              />
            ) : (
              <ConfirmDialog
                trigger={t.actions.archive}
                triggerVariant="secondary"
                title={t.actions.archiveTitle}
                description={t.actions.archiveBody}
                confirmLabel={t.actions.archive}
                action={archiveOrderAction}
                fields={hidden}
              />
            )}
            {canMarkPaid && (
              <ConfirmDialog
                trigger={t.actions.markPaid}
                triggerVariant="primary"
                tone="primary"
                title={t.actions.markPaidTitle}
                description={t.actions.markPaidBody}
                confirmLabel={t.actions.markPaidConfirm}
                action={markPaidAction}
                fields={hidden}
              >
                <Textarea
                  label={t.actions.markPaidNote}
                  name="note"
                  rows={2}
                  hint={t.actions.markPaidNoteHint}
                  maxLength={5000}
                />
              </ConfirmDialog>
            )}
          </>
        }
      />

      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        {order.archivedAt && <InlineAlert tone="info">{t.archivedBanner}</InlineAlert>}
        {oversold.length > 0 && (
          <InlineAlert tone="crit" title={t.oversold.title} live="none">
            <p>{t.oversold.body}</p>
            <ul className="mt-1.5 list-disc pl-5">
              {oversold.map((l) => (
                <li key={l.key}>{t.oversold.line(l.title, l.ordered, l.available)}</li>
              ))}
            </ul>
          </InlineAlert>
        )}

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <StatusStepper steps={steps} label={t.steps} stoppedLabel={stopped ? t.stopped : undefined} />
            <div className="flex flex-wrap items-center gap-2">
              <PaymentStatusPill status={order.paymentStatus} />
              {method && <span className="text-xs text-muted">{method}</span>}
              <FulfillmentStatusPill status={order.fulfillmentStatus} />
            </div>
          </div>
        </Card>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="grid min-w-0 gap-4">
            <section aria-labelledby="lines-title" className="grid gap-0">
              <div className="flex items-center justify-between px-0.5 pb-2">
                <h2 id="lines-title" className="type-label text-sm text-ink">
                  {t.lines.title}
                </h2>
                <span className="text-xs text-muted">{t.lines.aside}</span>
              </div>
              <DataTable
                caption={t.lines.caption}
                columns={lineColumns}
                rows={order.lines}
                rowKey={(l) => l.id}
                stickyHeader={false}
                footer={
                  <div className="px-3.5 py-3">
                    <KeyValue
                      className="ml-auto max-w-xs"
                      items={[
                        {
                          label: t.totals.subtotal,
                          value: <Money amount={order.subtotal} currency={cur} mono />,
                        },
                        {
                          label: `${t.totals.shipping}${order.shippingZoneName ? ` · ${order.shippingZoneName}` : ""}`,
                          value: <Money amount={order.shippingTotal} currency={cur} mono />,
                        },
                        ...(order.surchargeTotal
                          ? [
                              {
                                label: t.totals.surcharge,
                                value: <Money amount={order.surchargeTotal} currency={cur} mono />,
                              },
                            ]
                          : []),
                        {
                          label: t.totals.vat,
                          value: <span className="text-muted">{t.totals.vatValue}</span>,
                        },
                        {
                          label: <b className="text-ink">{t.totals.total}</b>,
                          value: (
                            <b>
                              <Money amount={order.total} currency={cur} mono />
                            </b>
                          ),
                        },
                      ]}
                    />
                  </div>
                }
              />
            </section>

            <section aria-labelledby="payments-title">
              <h2 id="payments-title" className="type-label px-0.5 pb-2 text-sm text-ink">
                {t.payments.title}
              </h2>
              <DataTable
                caption={t.payments.caption}
                columns={paymentColumns}
                rows={order.payments}
                rowKey={(p) => p.id}
                stickyHeader={false}
                empty={<p className="px-3 py-4 text-[13px] text-muted">{t.payments.none}</p>}
              />
            </section>

            <Card
              title={
                <span className="inline-flex items-center gap-2">
                  {t.fulfillment.title} <WipBadge />
                </span>
              }
            >
              <div className="grid gap-3">
                <p className="text-xs text-muted">{t.fulfillment.wipNote}</p>
                {(order.shippedAt || order.deliveredAt || order.trackingUrl) && (
                  <KeyValue
                    items={[
                      ...(order.shippedAt
                        ? [
                            {
                              label: t.fulfillment.shippedAt,
                              value: <DateTime value={order.shippedAt} timeZone={tz} />,
                            },
                          ]
                        : []),
                      ...(order.deliveredAt
                        ? [
                            {
                              label: t.fulfillment.deliveredAt,
                              value: <DateTime value={order.deliveredAt} timeZone={tz} />,
                            },
                          ]
                        : []),
                      ...(order.trackingUrl
                        ? [
                            {
                              label: t.fulfillment.trackingNumber,
                              value: (
                                <a
                                  href={order.trackingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono text-ink underline underline-offset-2"
                                >
                                  {order.trackingNumber ?? t.fulfillment.trackLink}
                                </a>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
                <FulfillmentForm
                  orderId={order.id}
                  paid={paid}
                  current={{
                    status: order.fulfillmentStatus,
                    carrier: order.carrier,
                    trackingNumber: order.trackingNumber,
                    trackingUrl: order.trackingUrl,
                  }}
                />
              </div>
            </Card>
          </div>

          <div className="grid min-w-0 gap-4">
            <Card
              title={t.customer.title}
              aside={order.customer ? (order.customer.registered ? t.customer.registered : t.customer.guest) : undefined}
            >
              <div className="grid gap-1 text-[13px]">
                <b className="font-semibold">{order.customerName}</b>
                <a href={`mailto:${order.email}`} className="text-muted hover:text-ink hover:underline">
                  {order.email}
                </a>
                {order.phone && <span className="text-muted">{order.phone}</span>}
                {order.customer ? (
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted">{t.customer.nth(order.customer.orderCount)}</span>
                    <Link href={`/admin/customers/${order.customer.id}`} className={buttonClasses({ size: "sm" })}>
                      {t.customer.open}
                    </Link>
                  </div>
                ) : (
                  <span className="mt-1 text-xs text-muted">{t.customer.noProfile}</span>
                )}
                {order.customerNote && (
                  <div className="mt-2 rounded-control border border-line bg-panel-2 px-2.5 py-2">
                    <div className="type-label text-[11px] text-muted">{t.customer.note}</div>
                    <p className="whitespace-pre-line">{order.customerNote}</p>
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {order.shippingMethod === "PICKUP" ? (
                  <Address title={t.addresses.shipping} lines={[t.addresses.pickup]} empty={t.addresses.none} />
                ) : (
                  <Address title={t.addresses.shipping} lines={shipLines} empty={t.addresses.none} />
                )}
                <Address
                  title={t.addresses.billing}
                  lines={billingSame ? [t.addresses.sameAsShipping] : billLines}
                  empty={t.addresses.none}
                />
              </div>
            </Card>

            <Card title={t.timeline.title}>
              {timeline.length ? <Timeline items={timeline} /> : <p className="text-[13px] text-muted">{t.timeline.empty}</p>}
            </Card>

            <Card title={t.note.title}>
              <NoteForm orderId={order.id} />
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
