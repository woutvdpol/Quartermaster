import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, buttonClasses, formatDate, formatMoney } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { getShippingBoard, SHIPPED_LANE_DAYS, type BoardCard } from "@/server/fulfillment";
import { requireTenantDisplay } from "@/server/tenant-display";
import { countryName, paymentMethodLabel } from "../orders/_lib/labels";
import { Board, type BoardCardView, type LaneId } from "./_components/Board";
import { boardCopy } from "./_copy";

const t = boardCopy;

export const metadata: Metadata = { title: t.title };

const DAY_MS = 24 * 60 * 60 * 1000;

function toView(o: BoardCard, lane: LaneId, timeZone: string, now: number): BoardCardView {
  const date = (d: Date | null) => (d ? formatDate(d, "date", timeZone) : "");
  let pill: BoardCardView["pill"];
  if (lane === "awaiting") {
    const days = Math.max(1, Math.ceil((now - o.placedAt.getTime()) / DAY_MS));
    pill = { tone: "info", label: [paymentMethodLabel(o.paymentMethod), t.day(days)].filter(Boolean).join(" · ") };
  } else if (lane === "shipped") {
    pill = o.fulfillmentStatus === "DELIVERED" ? { tone: "ok", label: t.delivered } : { tone: "ok", label: t.shippedOn(date(o.shippedAt)) };
  } else {
    pill = { tone: lane === "packed" ? "mute" : "warn", label: t.paid(date(o.paidAt)) };
  }
  const pickup = o.shippingMethod === "PICKUP";
  return {
    id: o.id,
    number: o.number,
    lane,
    status: o.fulfillmentStatus,
    customer: o.customerName,
    where: pickup ? t.pickup : o.shipTo ? o.shipTo.countryCode : null,
    whereTitle: pickup ? undefined : o.shipTo ? (countryName(o.shipTo.countryCode) ?? undefined) : undefined,
    items: t.items(o.lineCount),
    total: formatMoney(o.total, o.currency),
    pill,
    pickup,
    destination: { postalCode: o.shipTo?.postalCode ?? null, countryCode: o.shipTo?.countryCode ?? null },
    tracking: o.trackingUrl ? { url: o.trackingUrl, label: [o.carrier, o.trackingNumber].filter(Boolean).join(" · ") || "Track" } : null,
    carrier: o.carrier,
    trackingNumber: o.trackingNumber,
  };
}

export default async function ShippingBoardPage() {
  const ctx = await requireStaffContext();
  const [board, display] = await Promise.all([getShippingBoard(ctx), requireTenantDisplay(ctx.tenantId)]);
  // eslint-disable-next-line react-hooks/purity -- request-time reference for "day N" labels
  const now = Date.now();
  const lane = (id: LaneId) => {
    const l = board[id];
    return { id, total: l.total, cards: l.cards.map((c) => toView(c, id, display.timeZone, now)) };
  };

  return (
    <>
      <PageHeader
        crumb={
          <Link href="/admin/orders" className="hover:text-ink hover:underline">
            {t.crumb}
          </Link>
        }
        title={t.title}
        actions={
          <Link href="/admin/orders?view=toShip" className={buttonClasses()}>
            {t.list}
          </Link>
        }
      />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <p className="text-[13px] text-muted">{t.intro}</p>
        <Board lanes={[lane("awaiting"), lane("toPack"), lane("packed"), lane("shipped")]} shippedDays={SHIPPED_LANE_DAYS} />
      </div>
    </>
  );
}
