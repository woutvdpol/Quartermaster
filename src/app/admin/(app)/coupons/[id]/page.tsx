import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  ConfirmDialog,
  DataTable,
  DateTime,
  EmptyState,
  KeyValue,
  Money,
  PageHeader,
  Pagination,
  PaymentStatusPill,
  StatusPill,
  formatMoney,
  parsePage,
  type Column,
} from "@/components/admin/ui";
import { ServiceError, requireStaffContext } from "@/server/context";
import { getCoupon, listRedemptions, type RedemptionRow } from "@/server/coupons";
import { requireTenantDisplay } from "@/server/tenant-display";
import type { PaymentStatus } from "@/generated/prisma/enums";
import { CouponDrawer } from "../_components/CouponDrawer";
import { deleteCouponAction, setCouponActiveAction } from "../actions";
import { couponsCopy as t } from "../_copy";
import { couponState, describeDiscount, STATE_TONE } from "../_format";
import { dateToLocalInput } from "../_lib";

export const metadata: Metadata = { title: "Coupon" };
const PAGE_SIZE = 50;

export default async function CouponPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp, ctx] = await Promise.all([params, searchParams, requireStaffContext()]);
  const page = parsePage(sp.page);
  const [coupon, redemptions, tenant] = await Promise.all([
    getCoupon(ctx, id).catch((err) => {
      if (err instanceof ServiceError && err.code === "NOT_FOUND") notFound();
      throw err;
    }),
    listRedemptions(ctx, id, { page, pageSize: PAGE_SIZE }).catch(() => ({ rows: [] as RedemptionRow[], total: 0 })),
    requireTenantDisplay(ctx.tenantId),
  ]);
  const currency = tenant.currency;
  const money = (n: number) => formatMoney(n, currency);
  const state = couponState(coupon, new Date());

  const columns: Column<RedemptionRow>[] = [
    { key: "date", header: t.redemptionCols.date, cell: (r) => <DateTime value={r.createdAt} format="datetime" timeZone={tenant.timeZone} /> },
    { key: "order", header: t.redemptionCols.order, cell: (r) => (r.order ? <Link className="font-mono text-accent hover:underline" href={`/admin/orders/${r.order.id}`}>#{r.order.number}</Link> : "—") },
    { key: "email", header: t.redemptionCols.email, hideBelow: "md", cell: (r) => r.email },
    { key: "amount", header: t.redemptionCols.amount, numeric: true, cell: (r) => <Money amount={r.amount} currency={currency} mono /> },
    { key: "payment", header: t.redemptionCols.payment, cell: (r) => (r.order ? <PaymentStatusPill status={r.order.paymentStatus as PaymentStatus} /> : "—") },
    { key: "counts", header: t.redemptionCols.counts, hideBelow: "lg", cell: (r) => (r.counts ? "Yes" : <span title={t.countsNo}>No</span>) },
  ];

  const actions = (
    <div className="flex flex-wrap gap-2">
      {coupon.isActive ? (
        <ConfirmDialog trigger={t.deactivate} triggerVariant="ghost" title={t.deactivateTitle} description={t.deactivateBody} confirmLabel={t.deactivate} action={setCouponActiveAction} fields={{ id: coupon.id, active: "0" }} />
      ) : (
        <ConfirmDialog trigger={t.activate} triggerVariant="ghost" tone="primary" title={t.activate} confirmLabel={t.activate} action={setCouponActiveAction} fields={{ id: coupon.id, active: "1" }} />
      )}
      {coupon.redemptions === 0 ? <DeleteButton id={coupon.id} /> : null}
      <CouponDrawer
        trigger={t.edit}
        triggerVariant="primary"
        currency={currency}
        coupon={{
          id: coupon.id,
          code: coupon.code,
          description: coupon.description,
          type: coupon.type,
          value: coupon.value,
          minSubtotal: coupon.minSubtotal,
          startsAt: dateToLocalInput(coupon.startsAt, tenant.timeZone),
          endsAt: dateToLocalInput(coupon.endsAt, tenant.timeZone),
          maxRedemptions: coupon.maxRedemptions,
          perEmailLimit: coupon.perEmailLimit,
          isActive: coupon.isActive,
          used: coupon.redemptions > 0,
        }}
      />
    </div>
  );

  return (
    <>
      <PageHeader crumb={`${t.crumb} / ${t.title}`} title={coupon.code} actions={actions} />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card title="Details" aside={<StatusPill tone={STATE_TONE[state]}>{t.status[state]}</StatusPill>}>
          <KeyValue
            items={[
              { label: t.columns.type, value: describeDiscount(coupon, money) },
              { label: t.columns.usage, value: `${coupon.used} / ${coupon.maxRedemptions ?? t.unlimited}`, mono: true },
              { label: t.form.perEmail, value: coupon.perEmailLimit ?? t.unlimited, mono: true },
              { label: t.form.startsAt, value: coupon.startsAt ? <DateTime value={coupon.startsAt} format="datetime" timeZone={tenant.timeZone} /> : "—" },
              { label: t.form.endsAt, value: coupon.endsAt ? <DateTime value={coupon.endsAt} format="datetime" timeZone={tenant.timeZone} /> : "—" },
              ...(coupon.description ? [{ label: "Description", value: coupon.description }] : []),
            ]}
          />
        </Card>
        <section aria-labelledby="redemptions" className="grid min-w-0 content-start gap-2">
          <h2 id="redemptions" className="type-label text-sm text-ink">{t.redemptions}</h2>
          <DataTable
            caption={t.redemptions}
            columns={columns}
            rows={redemptions.rows}
            rowKey={(r) => r.id}
            empty={<EmptyState title={t.noRedemptions} compact />}
            footer={<Pagination page={page} pageSize={PAGE_SIZE} total={redemptions.total} basePath={`/admin/coupons/${coupon.id}`} searchParams={sp} />}
          />
        </section>
      </div>
    </>
  );
}

function DeleteButton({ id }: { id: string }) {
  return <ConfirmDialog trigger={t.deleteLabel} triggerVariant="ghost" title={t.deleteTitle} description={t.deleteBody} confirmLabel={t.deleteLabel} action={deleteCouponAction} fields={{ id }} />;
}
