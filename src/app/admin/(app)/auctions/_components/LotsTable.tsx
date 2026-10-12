"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  Button,
  ConfirmDialog,
  Money,
  Spinner,
  Thumb,
  controlClass,
  currencyDigits,
  cx,
  formatDate,
  formatMoneyInput,
  parseMoney,
  toast,
} from "@/components/admin/ui";
import type { AuctionStatus } from "@/generated/prisma/enums";
import { auctionsCopy as t } from "../_copy";
import { isEditable, lotPricesEditable } from "../_lib";
import type { AdminLot } from "../_types";
import { removeLotAction, reorderLotsAction, updateLotPriceAction } from "../actions";

const c = t.lots;

/** Inline money input: saves on blur / Enter. `nullable` = empty means "no reserve". */
function PriceInput({
  auctionId,
  lotId,
  field,
  value,
  currency,
  label,
  nullable,
}: {
  auctionId: string;
  lotId: string;
  field: "startPrice" | "reservePrice";
  value: number | null;
  currency: string;
  label: string;
  nullable: boolean;
}) {
  const initial = value === null ? "" : formatMoneyInput(value, currency);
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const [pending, start] = useTransition();

  function save() {
    if (text === saved) return;
    const empty = text.trim() === "";
    const minor = empty ? null : parseMoney(text, currencyDigits(currency));
    if ((empty && !nullable) || (!empty && (minor === null || minor < 0))) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    start(async () => {
      const res = await updateLotPriceAction(auctionId, lotId, field, minor);
      if (res.ok) {
        const next = minor === null ? "" : formatMoneyInput(minor, currency);
        setText(next);
        setSaved(next);
      } else {
        setInvalid(true);
        toast.crit(res.message ?? "Could not save.");
      }
    });
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-busy={pending || undefined}
      value={text}
      placeholder="—"
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        }
      }}
      className={cx(controlClass, "w-24 py-1 text-right font-mono tabular-nums", invalid && "border-crit")}
    />
  );
}

function closesLabel(lot: AdminLot, timeZone: string, sameDay: boolean): string {
  if (lot.status === "SOLD") return c.closedSold;
  if (lot.status === "CANCELLED") return c.cancelled;
  if (lot.status === "UNSOLD") return lot.bidCount > 0 ? c.closedNotMet : c.closedUnsold;
  const time = formatDate(lot.closesAt, sameDay ? "time" : "datetime", timeZone);
  return lot.extended ? `${time} ${c.extended}` : time;
}

type Props = {
  auctionId: string;
  status: AuctionStatus;
  lots: AdminLot[];
  currency: string;
  timeZone: string;
};

/** The lots table: inline start / reserve before the first bid, reorder (drag or ↑/↓) and remove before the auction is live. */
export function LotsTable({ auctionId, status, lots: initial, currency, timeZone }: Props) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const editable = isEditable(status);

  // The server's order wins unless the user has a reorder pending.
  const byId = new Map(initial.map((l) => [l.id, l]));
  const lots = order && order.length === initial.length && order.every((id) => byId.has(id)) ? order.map((id) => byId.get(id)!) : initial;
  const days = new Set(lots.filter((l) => l.status === "OPEN").map((l) => formatDate(l.closesAt, "date", timeZone)));
  const sameDay = days.size <= 1;

  function commit(next: string[]) {
    const prev = lots.map((l) => l.id);
    setOrder(next);
    start(async () => {
      const res = await reorderLotsAction(auctionId, next);
      if (res.ok) toast.ok(res.message ?? c.reordered);
      else {
        setOrder(prev);
        toast.crit(res.message ?? "Could not reorder.");
      }
    });
  }

  function move(index: number, delta: number) {
    const ids = lots.map((l) => l.id);
    const to = index + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    commit(ids);
  }

  function drop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = lots.map((l) => l.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    setDragId(null);
    commit(ids);
  }

  if (lots.length === 0) return <p className="p-3.5 text-sm text-muted">{c.empty}</p>;

  return (
    <div className="overflow-x-auto" aria-busy={saving || undefined}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th scope="col" className="w-14 px-3.5 py-2 font-medium">
              {c.cols.lot}
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              {c.cols.item}
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              {c.cols.start}
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              {c.cols.reserve}
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              {c.cols.current}
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              {c.cols.bids}
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              {c.cols.closes}
            </th>
            <th scope="col" className="w-10 px-2 py-2">
              <span className="sr-only">{c.cols.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lots.map((l, i) => {
            const pricesEditable = lotPricesEditable(status, l);
            const met = l.currentBid !== null && (l.reservePrice === null || l.currentBid >= l.reservePrice);
            return (
              <tr
                key={l.id}
                draggable={editable && !saving}
                onDragStart={(e) => {
                  setDragId(l.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (dragId) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(l.id);
                }}
                onDragEnd={() => setDragId(null)}
                className={cx("border-b border-line last:border-0", dragId === l.id && "opacity-50", l.status !== "OPEN" && "text-muted")}
              >
                <td className="px-3.5 py-2 align-top">
                  <span className="flex items-center gap-1">
                    {editable ? (
                      <span aria-hidden title={c.dragHandle} className="cursor-grab text-muted select-none">
                        ⋮⋮
                      </span>
                    ) : null}
                    <span className="font-mono">{l.lotNumber}</span>
                  </span>
                </td>
                <td className="px-2 py-2">
                  <span className="flex items-center gap-2.5">
                    <Thumb src={l.thumb ?? undefined} alt="" size="xs" />
                    <span className="min-w-0">
                      <Link href={`/admin/inventory/${l.productId}`} className="block font-mono text-xs text-muted hover:underline">
                        No. {l.stockCode}
                      </Link>
                      <span className="block max-w-[28ch] truncate text-ink">{l.title}</span>
                    </span>
                  </span>
                </td>
                <td className="px-2 py-2 text-right">
                  {pricesEditable ? (
                    <PriceInput auctionId={auctionId} lotId={l.id} field="startPrice" value={l.startPrice} currency={currency} label={`${c.cols.start} lot ${l.lotNumber}`} nullable={false} />
                  ) : (
                    <Money amount={l.startPrice} currency={currency} mono />
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  {pricesEditable ? (
                    <PriceInput auctionId={auctionId} lotId={l.id} field="reservePrice" value={l.reservePrice} currency={currency} label={`${c.cols.reserve} lot ${l.lotNumber}`} nullable />
                  ) : l.reservePrice === null ? (
                    <span className="text-muted">{c.noReserve}</span>
                  ) : (
                    <Money amount={l.reservePrice} currency={currency} mono />
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  {l.currentBid === null ? (
                    <span className="text-muted">{c.noBids}</span>
                  ) : (
                    <span className="grid justify-items-end">
                      <span className={cx("font-semibold", met ? "text-ok" : "text-warn")} title={met ? c.reserveMet : c.reserveNotMet}>
                        <Money amount={l.currentBid} currency={currency} mono />
                      </span>
                      {l.leader ? (
                        <Link href={`/admin/customers/${l.leader.customerId}`} className="text-xs text-muted hover:underline" title={l.leader.email}>
                          {l.leader.bidderNumber !== null ? `#${l.leader.bidderNumber} · ` : ""}
                          {l.leader.name}
                          {l.leadingMax !== null ? (
                            <>
                              {" · max "}
                              <Money amount={l.leadingMax} currency={currency} />
                            </>
                          ) : null}
                        </Link>
                      ) : null}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums">{l.bidCount}</td>
                <td className="px-2 py-2 font-mono text-xs whitespace-nowrap">{closesLabel(l, timeZone, sameDay)}</td>
                <td className="px-2 py-2 text-right">
                  {editable ? (
                    <span className="flex items-center justify-end gap-0.5">
                      <Button variant="ghost" size="sm" aria-label={`${c.moveUp}: lot ${l.lotNumber}`} disabled={i === 0 || saving} onClick={() => move(i, -1)}>
                        ↑
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`${c.moveDown}: lot ${l.lotNumber}`} disabled={i === lots.length - 1 || saving} onClick={() => move(i, 1)}>
                        ↓
                      </Button>
                      <ConfirmDialog
                        trigger="×"
                        triggerLabel={`${c.remove}: lot ${l.lotNumber}`}
                        triggerVariant="ghost"
                        triggerSize="sm"
                        title={c.removeTitle}
                        description={c.removeBody}
                        confirmLabel={c.remove}
                        action={removeLotAction}
                        fields={{ auctionId, lotId: l.id }}
                      />
                    </span>
                  ) : saving ? (
                    <Spinner />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
