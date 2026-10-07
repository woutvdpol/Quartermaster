"use client";

import Link from "next/link";
import { useCallback, useOptimistic, useState, useTransition, type DragEvent } from "react";
import type { FulfillmentStatus } from "@/generated/prisma/enums";
import { StatusPill, buttonClasses, cx, toast, type StatusTone } from "@/components/admin/ui";
import { moveOrderAction } from "../actions";
import { boardCopy } from "../_copy";
import { ShipDrawer, type ShipTarget } from "./ShipDrawer";

const t = boardCopy;

export type LaneId = "awaiting" | "toPack" | "packed" | "shipped";

export type BoardCardView = {
  id: string;
  number: number;
  lane: LaneId;
  status: FulfillmentStatus;
  customer: string;
  where: string | null;
  whereTitle?: string;
  items: string;
  total: string;
  pill: { tone: StatusTone; label: string };
  pickup: boolean;
  destination: { postalCode: string | null; countryCode: string | null };
  tracking: { url: string; label: string } | null;
  carrier: string | null;
  trackingNumber: string | null;
};

type LaneView = { id: LaneId; total: number; cards: BoardCardView[] };
type Move = "UNFULFILLED" | "PACKED" | "DELIVERED";

const LANE_TITLE: Record<LaneId, string> = t.lanes;
/** Lanes a card may be dropped on. Shipped opens the ship form instead of moving directly. */
const DROPPABLE: LaneId[] = ["toPack", "packed", "shipped"];
const LANE_FOR_STATUS: Record<Move, LaneId> = { UNFULFILLED: "toPack", PACKED: "packed", DELIVERED: "shipped" };

export function Board({ lanes, shippedDays }: { lanes: LaneView[]; shippedDays: number }) {
  const [optimistic, applyMove] = useOptimistic(lanes, (state: LaneView[], move: { id: string; to: Move }) => {
    const card = state.flatMap((l) => l.cards).find((c) => c.id === move.id);
    if (!card) return state;
    const dest = LANE_FOR_STATUS[move.to];
    const moved = { ...card, lane: dest, status: move.to as FulfillmentStatus };
    return state.map((l) => {
      const cards = l.cards.filter((c) => c.id !== move.id);
      if (l.id === dest) cards.unshift(moved);
      return { ...l, cards, total: l.total + (l.id === dest ? 1 : 0) - (l.id === card.lane ? 1 : 0) };
    });
  });
  const [, startTransition] = useTransition();
  const [shipTarget, setShipTarget] = useState<ShipTarget | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<LaneId | null>(null);
  const closeShip = useCallback(() => setShipTarget(null), []);

  const allCards = optimistic.flatMap((l) => l.cards);
  const liveSelected = [...selected].filter((id) => allCards.some((c) => c.id === id && c.lane !== "awaiting"));

  const move = (card: BoardCardView, to: Move) => {
    startTransition(async () => {
      applyMove({ id: card.id, to });
      const res = await moveOrderAction({ id: card.id, number: card.number, to });
      if (res.ok) toast.ok(res.message ?? "Saved.");
      else toast.crit(res.message ?? "Something went wrong.");
    });
  };

  const openShip = (card: BoardCardView) =>
    setShipTarget({
      id: card.id,
      number: card.number,
      pickup: card.pickup,
      destination: card.destination,
      carrier: card.carrier,
      trackingNumber: card.trackingNumber,
    });

  const onDrop = (lane: LaneId, e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/x-qm-order") || dragging;
    setDragging(null);
    const card = allCards.find((c) => c.id === id);
    if (!card || card.lane === lane) return;
    if (lane === "shipped") {
      if (card.status === "SHIPPED" || card.status === "DELIVERED") return;
      openShip(card);
    } else if (lane === "toPack") move(card, "UNFULFILLED");
    else if (lane === "packed") move(card, "PACKED");
  };

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const slipsHref = `/admin/shipping-board/packing-slips?ids=${liveSelected.map(encodeURIComponent).join(",")}`;

  return (
    <>
      {liveSelected.length > 0 && (
        <div
          role="region"
          aria-label={t.selected(liveSelected.length)}
          className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-card bg-rail px-3.5 py-2 text-[13px] text-rail-ink shadow-pop"
        >
          <span>{t.selected(liveSelected.length)}</span>
          <a href={slipsHref} target="_blank" rel="noopener" className={buttonClasses({ size: "sm", variant: "primary" })}>
            {t.printSlips(liveSelected.length)}
          </a>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-xs underline underline-offset-2">
            {t.clear}
          </button>
        </div>
      )}

      <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {optimistic.map((lane) => {
          const droppable = DROPPABLE.includes(lane.id) && dragging !== null;
          const headingId = `lane-${lane.id}`;
          const selectable = lane.id !== "awaiting" && lane.cards.length > 0;
          const allOn = selectable && lane.cards.every((c) => selected.has(c.id));
          return (
            <section
              key={lane.id}
              aria-labelledby={headingId}
              onDragOver={(e) => {
                if (!droppable) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== lane.id) setOver(lane.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === lane.id ? null : o));
              }}
              onDrop={(e) => droppable && onDrop(lane.id, e)}
              className={cx(
                "grid content-start gap-2 rounded-card border bg-panel p-2.5 shadow-card transition-colors",
                over === lane.id ? "border-accent bg-panel-2" : "border-line",
              )}
            >
              <h2 id={headingId} className="type-label flex items-center gap-2 text-[13px] text-ink">
                {selectable && (
                  <input
                    type="checkbox"
                    aria-label={t.selectLane(LANE_TITLE[lane.id])}
                    checked={allOn}
                    onChange={(e) => lane.cards.forEach((c) => toggle(c.id, e.target.checked))}
                    className="size-3.5 cursor-pointer accent-accent"
                  />
                )}
                <span className="flex-1">{LANE_TITLE[lane.id]}</span>
                <span className="font-mono text-xs text-muted">{lane.total}</span>
              </h2>
              {lane.id === "shipped" && <p className="text-xs text-muted">{t.shippedAside(shippedDays)}</p>}
              {t.more(lane.cards.length, lane.total) && <p className="text-xs text-muted">{t.more(lane.cards.length, lane.total)}</p>}
              {lane.cards.length === 0 ? (
                <p className="rounded-control border border-dashed border-line px-2.5 py-3 text-center text-xs text-muted">
                  {droppable ? t.dropHere : t.empty}
                </p>
              ) : (
                <ul className="grid gap-2">
                  {lane.cards.map((card) => (
                    <Card
                      key={card.id}
                      card={card}
                      selected={selected.has(card.id)}
                      onSelect={(on) => toggle(card.id, on)}
                      onMove={(to) => move(card, to)}
                      onShip={() => openShip(card)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/x-qm-order", card.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(card.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      dragging={dragging === card.id}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <ShipDrawer target={shipTarget} onClose={closeShip} />
    </>
  );
}

function Card({
  card,
  selected,
  onSelect,
  onMove,
  onShip,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  card: BoardCardView;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onMove: (to: Move) => void;
  onShip: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const movable = card.lane !== "awaiting";
  const who = [card.customer, card.where, card.items].filter(Boolean).join(" · ");
  const btn = buttonClasses({ size: "sm", className: "!px-2 !py-0.5 text-xs" });
  const primary = buttonClasses({ size: "sm", variant: "primary", className: "!px-2 !py-0.5 text-xs" });
  return (
    <li
      draggable={movable}
      onDragStart={movable ? onDragStart : undefined}
      onDragEnd={onDragEnd}
      className={cx(
        "grid gap-1.5 rounded-control border bg-panel-2 px-2.5 py-2 text-[12.5px] transition-colors",
        selected ? "border-accent" : "border-line hover:border-line-strong",
        movable && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      <div className="flex items-baseline gap-2">
        {movable && (
          <input
            type="checkbox"
            aria-label={t.select(card.number)}
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
            className="size-3.5 shrink-0 translate-y-[2px] cursor-pointer accent-accent"
          />
        )}
        <Link href={`/admin/orders/${card.id}`} className="font-mono font-bold text-ink underline-offset-2 hover:underline">
          #{card.number}
        </Link>
        <span className="ml-auto font-mono tabular-nums">{card.total}</span>
      </div>
      <span className="truncate text-ink-2" title={card.whereTitle}>
        {who}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusPill tone={card.pill.tone}>{card.pill.label}</StatusPill>
        {card.tracking && (
          <a href={card.tracking.url} target="_blank" rel="noopener noreferrer" className="truncate font-mono text-[11.5px] text-muted underline underline-offset-2 hover:text-ink">
            {card.tracking.label}
          </a>
        )}
      </span>
      {movable && (
        <div role="group" aria-label={t.actions.moveLabel(card.number)} className="flex flex-wrap gap-1.5 pt-0.5">
          {card.lane === "toPack" && (
            <>
              <button type="button" className={btn} onClick={() => onMove("PACKED")}>
                {t.actions.pack}
              </button>
              <button type="button" className={primary} onClick={onShip}>
                {t.actions.ship}
              </button>
            </>
          )}
          {card.lane === "packed" && (
            <>
              <button type="button" className={primary} onClick={onShip}>
                {t.actions.ship}
              </button>
              <button type="button" className={btn} onClick={() => onMove("UNFULFILLED")}>
                {t.actions.unpack}
              </button>
            </>
          )}
          {card.lane === "shipped" && card.status === "SHIPPED" && (
            <>
              <button type="button" className={btn} onClick={() => onMove("DELIVERED")}>
                {t.actions.deliver}
              </button>
              <button type="button" className={btn} onClick={() => onMove("PACKED")}>
                {t.actions.backToPacked}
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
