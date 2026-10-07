"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { currencyDigits, formatMoney } from "@/components/admin/ui";
import { copy } from "../_copy";
import { compactMoney, dayLabel, niceScale } from "./chart-utils";

type Point = { day: string; revenue: number; orders: number };

type Props = {
  data: Point[];
  currency: string;
  days: number;
};

const HEIGHT = 210;
const M = { top: 12, right: 14, bottom: 26, left: 56 };

/**
 * Revenue per tenant-local day: area + 2px line, to scale from zero, recessive grid, the last point
 * emphasised. Hover / arrow keys show a crosshair with the exact value. A table view sits underneath.
 */
export function RevenueChart({ data, currency, days }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const digits = currencyDigits(currency);
  const max = Math.max(0, ...data.map((d) => d.revenue));
  const { top, ticks } = useMemo(() => niceScale(max, 10 ** digits * 100), [max, digits]);

  const innerW = width - M.left - M.right;
  const innerH = HEIGHT - M.top - M.bottom;
  const n = data.length;
  const x = (i: number) => M.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => M.top + innerH - (v / top) * innerH;

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(d.revenue).toFixed(1)}`).join(" ");
  const area = n ? `${line} L${x(n - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z` : "";

  // x labels: every day for a week, otherwise first / middle / last.
  const labelIdx = n <= 8 ? data.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const total = data.reduce((s, d) => s + d.revenue, 0);
  const totalOrders = data.reduce((s, d) => s + d.orders, 0);
  const last = n - 1;
  const shown = active ?? null;

  function onPointer(e: PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * innerW;
    setActive(Math.max(0, Math.min(n - 1, Math.round((px / innerW) * (n - 1)))));
  }

  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    if (!n) return;
    const cur = active ?? last;
    const next = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: last }[e.key];
    if (next === undefined) {
      if (e.key === "Escape") setActive(null);
      return;
    }
    e.preventDefault();
    setActive(Math.max(0, Math.min(last, next)));
  }

  const tip = shown !== null ? data[shown] : null;
  const tipLeft = shown !== null ? x(shown) : 0;

  return (
    <div className="grid gap-2">
      <div ref={wrapRef} className="relative">
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={`${copy.chart.aria(days)}. ${copy.chart.total}: ${formatMoney(total, currency)}, ${copy.chart.ordersCount(totalOrders)}.`}
          aria-describedby={tip ? tipId : undefined}
          tabIndex={0}
          onKeyDown={onKey}
          onFocus={() => setActive((a) => a ?? last)}
          onBlur={() => setActive(null)}
          className="block max-w-full touch-pan-y rounded-control"
        >
          {/* grid + y labels */}
          <g aria-hidden="true">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted font-mono text-[11px]">
                  {compactMoney(t, currency)}
                </text>
              </g>
            ))}
            {labelIdx.map((i) => (
              <text
                key={i}
                x={x(i)}
                y={HEIGHT - 6}
                textAnchor={n <= 8 ? "middle" : i === 0 ? "start" : i === last ? "end" : "middle"}
                className="fill-muted font-mono text-[11px]"
              >
                {dayLabel(data[i].day)}
              </text>
            ))}
          </g>

          {/* marks */}
          <g aria-hidden="true">
            <path d={area} className="fill-accent" fillOpacity={0.14} />
            <path d={line} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {n > 0 && shown === null && (
              <circle cx={x(last)} cy={y(data[last].revenue)} r={4.5} className="fill-accent stroke-panel" strokeWidth={2} />
            )}
            {tip && shown !== null && (
              <>
                <line x1={x(shown)} x2={x(shown)} y1={M.top} y2={M.top + innerH} className="stroke-line-strong" strokeWidth={1} />
                <circle cx={x(shown)} cy={y(tip.revenue)} r={4.5} className="fill-accent stroke-panel" strokeWidth={2} />
              </>
            )}
          </g>

          {/* hit area larger than the marks */}
          <rect
            x={M.left}
            y={0}
            width={innerW}
            height={HEIGHT}
            fill="transparent"
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setActive(null)}
          />
        </svg>

        {max === 0 && (
          <p className="pointer-events-none absolute inset-x-0 top-[38%] text-center text-[13px] text-muted">{copy.chart.empty}</p>
        )}

        {tip && (
          <div
            id={tipId}
            role="status"
            className="pointer-events-none absolute top-1 z-10 rounded-control border border-line bg-panel px-2.5 py-1.5 text-xs shadow-pop"
            style={{
              left: Math.min(Math.max(tipLeft, 70), width - 70),
              transform: "translateX(-50%)",
            }}
          >
            <div className="text-muted">{dayLabel(tip.day, true)}</div>
            <div className="font-mono font-semibold tabular-nums text-ink">{formatMoney(tip.revenue, currency)}</div>
            <div className="text-muted">{copy.chart.ordersCount(tip.orders)}</div>
          </div>
        )}
      </div>

      <details className="text-[13px]">
        <summary className="cursor-pointer text-xs text-muted hover:text-ink">{copy.chart.table}</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-control border border-line">
          <table className="w-full text-[13px]">
            <caption className="sr-only">{copy.chart.aria(days)}</caption>
            <thead className="sticky top-0 bg-panel">
              <tr className="type-label text-[11px] text-muted">
                <th scope="col" className="border-b border-line px-2.5 py-1.5 text-left">{copy.chart.day}</th>
                <th scope="col" className="border-b border-line px-2.5 py-1.5 text-right">{copy.chart.orders}</th>
                <th scope="col" className="border-b border-line px-2.5 py-1.5 text-right">{copy.chart.revenue}</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.day} className="border-b border-line last:border-b-0">
                  <th scope="row" className="px-2.5 py-1 text-left font-normal">{dayLabel(d.day, true)}</th>
                  <td className="px-2.5 py-1 text-right font-mono tabular-nums">{d.orders}</td>
                  <td className="px-2.5 py-1 text-right font-mono tabular-nums">{formatMoney(d.revenue, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
