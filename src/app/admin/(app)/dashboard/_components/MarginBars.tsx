import { formatMoney } from "@/components/admin/ui";
import type { MarginRow } from "@/server/purchasing";
import { copy } from "../_copy";

/**
 * Horizontal bars of margin % per group (server component). The scale is fixed at 0–100 % (wider
 * when a value falls outside it), so bars are comparable over time. Every bar carries a direct label.
 */
export function MarginBars({ rows, currency }: { rows: MarginRow[]; currency: string }) {
  const pcts = rows.map((r) => r.marginPct ?? 0);
  const lo = Math.min(0, ...pcts);
  const hi = Math.max(100, ...pcts);
  const span = hi - lo;
  const zero = ((0 - lo) / span) * 100;

  return (
    <ul aria-label={copy.margin.aria} className="grid gap-2.5">
      {rows.map((r) => {
        const pct = r.marginPct;
        const start = pct == null ? zero : Math.min(zero, ((pct - lo) / span) * 100);
        const width = pct == null ? 0 : Math.abs(((pct - lo) / span) * 100 - zero);
        const negative = (pct ?? 0) < 0;
        return (
          <li
            key={r.key ?? r.label}
            className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[13px]"
            title={`${r.label}: revenue ${formatMoney(r.costedRevenue, currency)}, cost ${formatMoney(r.cost, currency)}, margin ${formatMoney(r.margin, currency)}`}
          >
            <span className="truncate">{r.label}</span>
            <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" className="block h-3 w-full">
              <rect x={0} y={0} width={100} height={10} className="fill-panel-2" rx={0} />
              {width > 0 && (
                <rect x={start} y={0} width={Math.max(width, 0.6)} height={10} className={negative ? "fill-crit" : "fill-accent"} />
              )}
              {lo < 0 && <line x1={zero} x2={zero} y1={0} y2={10} className="stroke-line-strong" vectorEffect="non-scaling-stroke" />}
            </svg>
            <span className="min-w-[4.5rem] text-right font-mono tabular-nums">
              {pct == null ? <span className="text-muted">{copy.margin.noCost}</span> : `${pct.toLocaleString("en-NL", { maximumFractionDigits: 1 })}%`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
