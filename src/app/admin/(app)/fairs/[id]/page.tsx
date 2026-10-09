import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, ConfirmDialog, DateTime, KpiCard, Money, PageHeader, StatusPill, Thumb, buttonClasses, controlClass, formatMoney, hintClass, labelClass } from "@/components/admin/ui";
import { ServiceError, requireStaffContext } from "@/server/context";
import { FAIR_METHOD_LABELS, getFair, getFairReport, type FairPaymentMethod } from "@/server/fairs";
import { requireTenantDisplay } from "@/server/tenant-display";
import { FairDrawer } from "../_components/FairDrawer";
import { FloorInput, ItemPicker, RemoveItemButton } from "../_components/ItemControls";
import { deleteFairAction, endFairAction, startFairAction } from "../actions";
import { fairsCopy as t } from "../_copy";
import { FAIR_STATUS_TONE, dayInput } from "../_lib";

export const metadata: Metadata = { title: "Fair" };

export default async function FairPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, ctx] = await Promise.all([params, requireStaffContext()]);
  const [fair, report, tenant] = await Promise.all([
    getFair(ctx, id).catch((err) => {
      if (err instanceof ServiceError && err.code === "NOT_FOUND") notFound();
      throw err;
    }),
    getFairReport(ctx, id),
    requireTenantDisplay(ctx.tenantId),
  ]);
  const currency = tenant.currency;
  const money = (n: number) => formatMoney(n, currency);
  const ended = fair.status === "ENDED";
  const unsold = fair.items.filter((i) => !i.soldAt);
  const step = fair.status === "PREPARING" ? 1 : fair.status === "LIVE" ? 2 : 3;
  const dates = (
    <>
      <DateTime value={fair.startsOn} format="date" timeZone="UTC" />
      {fair.endsOn && fair.endsOn.getTime() !== fair.startsOn.getTime() ? (
        <>
          {" – "}
          <DateTime value={fair.endsOn} format="date" timeZone="UTC" />
        </>
      ) : null}
    </>
  );

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill tone={FAIR_STATUS_TONE[fair.status]}>{t.status[fair.status]}</StatusPill>
      {fair.status === "PREPARING" ? (
        <ConfirmDialog trigger={t.deleteLabel} triggerVariant="ghost" title={t.deleteTitle} description={t.deleteBody} confirmLabel={t.deleteLabel} action={deleteFairAction} fields={{ id: fair.id }} />
      ) : null}
      <FairDrawer
        trigger={t.edit}
        fair={{ id: fair.id, name: fair.name, startsOn: dayInput(fair.startsOn), endsOn: dayInput(fair.endsOn), hideFromShop: fair.hideFromShop, notes: fair.notes ?? "" }}
      />
      {fair.status === "LIVE" ? (
        <Link href={`/admin/fair/${fair.id}`} className={buttonClasses({ variant: "primary" })}>
          {t.live.openSell}
        </Link>
      ) : null}
    </div>
  );

  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link href="/admin/fairs" className="hover:underline">
              {t.title}
            </Link>{" "}
            › {dates}
          </>
        }
        title={fair.name}
        actions={actions}
      />
      <div className="grid gap-4 p-4 md:px-[22px] md:py-5">
        <ol className="flex flex-wrap gap-2 text-xs" aria-label="Fair steps">
          {([t.steps.prepare, t.steps.live, t.steps.end] as const).map((label, i) => (
            <li
              key={label}
              aria-current={step === i + 1 ? "step" : undefined}
              className={`rounded-control border px-2.5 py-1 ${step === i + 1 ? "border-accent bg-accent text-on-accent" : "border-line bg-panel text-muted"}`}
            >
              {i + 1} {label}
              {step > i + 1 ? " ✓" : ""}
            </li>
          ))}
        </ol>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1fr)]">
          {/* 1 — items */}
          <Card title={t.items.title(fair.items.length)} aside={ended ? null : <ItemPicker fairId={fair.id} currency={currency} />} padded={false}>
            {fair.items.length === 0 ? (
              <p className="p-3.5 text-sm text-muted">{t.items.empty}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th scope="col" className="px-3.5 py-2 font-medium">
                      {t.items.cols.item}
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      {t.items.cols.list}
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      {t.items.cols.floor}
                    </th>
                    <th scope="col" className="w-10 px-2 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {fair.items.map((i) => {
                    const unavailable = !i.soldAt && i.productStatus !== "ACTIVE";
                    return (
                      <tr key={i.id} className="border-b border-line last:border-0">
                        <td className="px-3.5 py-2">
                          <span className="flex items-center gap-2.5">
                            <Thumb src={i.thumb ?? undefined} alt="" size="xs" />
                            <span className="min-w-0">
                              <Link href={`/admin/inventory/${i.productId}`} className="block font-mono text-xs text-muted hover:underline">
                                No. {i.stockCode}
                              </Link>
                              <span className="block truncate">{i.title}</span>
                              {i.soldAt ? (
                                <StatusPill tone="ok">
                                  {i.orderId ? <Link href={`/admin/orders/${i.orderId}`}>{t.items.sold(money(i.soldPrice ?? 0))}</Link> : t.items.sold(money(i.soldPrice ?? 0))}
                                </StatusPill>
                              ) : i.heldElsewhere ? (
                                <StatusPill tone="warn">{t.items.heldElsewhere}</StatusPill>
                              ) : unavailable ? (
                                <StatusPill tone="crit">{t.items.notForSale}</StatusPill>
                              ) : i.held ? (
                                <StatusPill tone="info">{t.items.held}</StatusPill>
                              ) : null}
                            </span>
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Money amount={i.listPrice} currency={currency} mono />
                        </td>
                        <td className="px-2 py-2 text-right">
                          {i.soldAt || ended ? (
                            <Money amount={i.floorPrice} currency={currency} mono />
                          ) : (
                            <FloorInput fairId={fair.id} productId={i.productId} floor={i.floorPrice} currency={currency} label={`${t.items.cols.floor} No. ${i.stockCode}`} />
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {!i.soldAt && !ended ? <RemoveItemButton fairId={fair.id} productId={i.productId} label={`${t.items.remove} No. ${i.stockCode}`} /> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className={`${hintClass} border-t border-line px-3.5 py-2`}>{t.items.floorHint}</p>
          </Card>

          {/* 2 — labels */}
          <Card title={t.labels.title}>
            <form method="get" action={`/admin/fairs/${fair.id}/labels`} target="_blank" className="grid gap-3">
              <label className="grid gap-1">
                <span className={labelClass}>{t.labels.layout}</span>
                <select name="layout" defaultValue="a4" className={controlClass}>
                  {(Object.keys(t.labels.layouts) as (keyof typeof t.labels.layouts)[]).map((k) => (
                    <option key={k} value={k}>
                      {t.labels.layouts[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-[13.5px]">
                <input type="checkbox" name="price" value="1" defaultChecked className="size-3.5 accent-accent" />
                {t.labels.price}
              </label>
              <p className={hintClass}>{t.labels.hint}</p>
              <button type="submit" className={buttonClasses({ variant: "secondary" })} disabled={unsold.length === 0}>
                {t.labels.print(unsold.length)}
              </button>
            </form>
          </Card>

          {/* 3 — live / report */}
          <Card title={fair.status === "ENDED" ? t.live.report : t.live.title} aside={report.items ? t.live.unsold(report.unsold) : null}>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <KpiCard label={t.live.sold} value={report.count} />
                <KpiCard
                  label={t.live.revenue}
                  value={money(report.revenue)}
                  note={t.live.split(money(report.byMethod.card.amount), money(report.byMethod.cash.amount), money(report.byMethod.invoice.amount))}
                />
                <KpiCard label={t.live.margin} value={money(report.margin)} note={report.marginUnknown ? t.live.marginUnknown(report.marginUnknown) : undefined} />
                <KpiCard label={t.live.vsList} value={report.averageVsList === null ? "—" : `${report.averageVsList > 0 ? "+" : ""}${Math.round(report.averageVsList * 100)}%`} />
              </div>
              <div>
                <h3 className="type-label mb-1 text-xs text-muted">{t.live.latest}</h3>
                {report.latest.length === 0 ? (
                  <p className="text-sm text-muted">{t.live.noSales}</p>
                ) : (
                  <ul className="grid gap-1 text-sm">
                    {report.latest.map((s) => (
                      <li key={s.orderId} className="flex justify-between gap-2">
                        <Link href={`/admin/orders/${s.orderId}`} className="min-w-0 truncate hover:underline">
                          <span className="font-mono text-xs text-muted">{s.stockCode}</span> {s.title} · {FAIR_METHOD_LABELS[s.method as FairPaymentMethod] ?? s.method}
                        </Link>
                        <Money amount={s.price} currency={currency} mono />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {report.cashExpected > 0 ? <p className="rounded-control border border-warn bg-warn-soft px-3 py-2 text-sm">{t.live.cash(money(report.cashExpected))}</p> : null}
              {fair.status === "PREPARING" ? (
                <ConfirmDialog trigger={t.live.start} triggerVariant="primary" tone="primary" title={t.live.startTitle} description={t.live.startBody(fair.hideFromShop)} confirmLabel={t.live.start} action={startFairAction} fields={{ id: fair.id }} />
              ) : null}
              {fair.status === "LIVE" ? (
                <>
                  <p className={hintClass}>{t.live.sellHint}</p>
                  <ConfirmDialog trigger={t.live.end(unsold.length)} title={t.live.endTitle} description={t.live.endBody} confirmLabel={t.live.endTitle.replace("?", "")} tone="primary" action={endFairAction} fields={{ id: fair.id }} />
                </>
              ) : null}
              <p className={hintClass}>{t.live.ordersNote}</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
