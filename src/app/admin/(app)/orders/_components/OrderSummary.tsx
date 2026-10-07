import Link from "next/link";
import {
  DateTime,
  FulfillmentStatusPill,
  InlineAlert,
  KeyValue,
  Money,
  PaymentStatusPill,
  Timeline,
} from "@/components/admin/ui";
import type { OrderDetail } from "@/server/orders/queries";
import { ordersCopy, orderCopy } from "../_copy";
import { addressLines, describeEvent, paymentMethodLabel, surchargeRowLabel } from "../_lib/labels";

const t = ordersCopy.drawer;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="type-label mb-2 text-[11.5px] text-muted">{children}</h3>;
}

/** Compact order summary for the list drawer (design C): customer, items, totals, payment, latest events. */
export function OrderSummary({ order, timeZone }: { order: OrderDetail; timeZone: string }) {
  const method = paymentMethodLabel(order.paymentMethod);
  const oversold = order.events.some((e) => e.type === "stock.oversold");
  const recent = [...order.events].reverse().slice(0, 5);
  const ship = order.shippingAddress;

  return (
    <div className="grid gap-5 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <PaymentStatusPill status={order.paymentStatus} />
        {method && <span className="text-muted">{method}</span>}
        <FulfillmentStatusPill status={order.fulfillmentStatus} />
        {order.archivedAt && <span className="text-xs text-muted">· {ordersCopy.views.archived}</span>}
      </div>

      {oversold && (
        <InlineAlert tone="crit" title={orderCopy.oversold.title}>
          {orderCopy.oversold.body}
        </InlineAlert>
      )}

      <section>
        <SectionTitle>{t.customer}</SectionTitle>
        <div className="grid gap-0.5">
          {order.customer ? (
            <Link
              href={`/admin/customers/${order.customer.id}`}
              className="font-medium text-ink underline-offset-2 hover:underline"
            >
              {order.customerName}
            </Link>
          ) : (
            <span className="font-medium">{order.customerName}</span>
          )}
          <span className="text-muted">{order.email}</span>
          {order.shippingMethod === "PICKUP" ? (
            <span className="mt-1">{t.pickup}</span>
          ) : ship ? (
            <span className="mt-1 text-ink-2">{addressLines(ship).slice(1).join(", ")}</span>
          ) : null}
          {order.customer && <span className="text-xs text-muted">{orderCopy.customer.nth(order.customer.orderCount)}</span>}
        </div>
      </section>

      <section>
        <SectionTitle>{t.items}</SectionTitle>
        <ul className="grid gap-1.5">
          {order.lines.map((line) => (
            <li key={line.id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                {line.title}
                {line.stockCode !== null && <span className="ml-1.5 font-mono text-xs text-muted">#{line.stockCode}</span>}
                {line.quantity > 1 && <span className="ml-1.5 font-mono text-xs text-muted">×{line.quantity}</span>}
              </span>
              <Money amount={line.lineTotal} currency={order.currency} mono />
            </li>
          ))}
        </ul>
        <KeyValue
          className="mt-3 border-t border-line pt-3"
          items={[
            {
              label: orderCopy.totals.shipping + (order.shippingZoneName ? ` · ${order.shippingZoneName}` : ""),
              value: <Money amount={order.shippingTotal} currency={order.currency} mono />,
            },
            ...(order.surchargeTotal
              ? [
                  {
                    label: surchargeRowLabel(order, orderCopy.totals.surcharge),
                    value: <Money amount={order.surchargeTotal} currency={order.currency} mono />,
                  },
                ]
              : []),
            {
              label: orderCopy.totals.vat,
              value: <span className="text-muted">{orderCopy.totals.vatValue}</span>,
            },
            {
              label: <b className="text-ink">{orderCopy.totals.total}</b>,
              value: (
                <b>
                  <Money amount={order.total} currency={order.currency} mono />
                </b>
              ),
            },
          ]}
        />
      </section>

      <section>
        <SectionTitle>{t.payment}</SectionTitle>
        {order.payments.length === 0 ? (
          <p className="text-muted">{orderCopy.payments.none}</p>
        ) : (
          <ul className="grid gap-1.5">
            {order.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {p.provider === "MANUAL" ? orderCopy.payments.manual : orderCopy.payments.mollie}
                  {p.providerPaymentId && <span className="ml-1.5 font-mono text-xs text-muted">{p.providerPaymentId}</span>}
                  {paymentMethodLabel(p.method) && <span className="text-muted"> · {paymentMethodLabel(p.method)}</span>}
                </span>
                <span className="font-mono text-xs text-muted">
                  {p.status.toLowerCase()} · <DateTime value={p.paidAt ?? p.createdAt} timeZone={timeZone} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>{orderCopy.timeline.title}</SectionTitle>
        {recent.length === 0 ? (
          <p className="text-muted">{orderCopy.timeline.empty}</p>
        ) : (
          <Timeline
            items={recent.map((e) => {
              const d = describeEvent(e);
              return {
                id: e.id,
                title: d.title,
                body: d.detail,
                tone: d.tone,
                highlight: d.highlight,
                meta: (
                  <>
                    <DateTime value={e.createdAt} timeZone={timeZone} /> · {e.actor?.name ?? orderCopy.timeline.system}
                  </>
                ),
              };
            })}
          />
        )}
      </section>
    </div>
  );
}
