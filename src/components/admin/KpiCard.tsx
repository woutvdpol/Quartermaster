import type { ReactNode } from "react";

type Trend = "up" | "down" | "flat";

type KpiCardProps = {
  label: string;
  value: ReactNode;
  /** Change versus the comparison period, e.g. "12.4%". */
  delta?: string;
  trend?: Trend;
  /** Muted context after the delta, e.g. "vs. previous 30 days". */
  note?: ReactNode;
};

const trendStyle: Record<Trend, { cls: string; sign: string; label: string }> = {
  up: { cls: "text-ok", sign: "▲", label: "up" },
  down: { cls: "text-crit", sign: "▼", label: "down" },
  flat: { cls: "text-muted", sign: "■", label: "unchanged" },
};

export function KpiCard({ label, value, delta, trend = "flat", note }: KpiCardProps) {
  const t = trendStyle[trend];
  return (
    <div className="rounded-card border border-line bg-panel p-3.5 shadow-card">
      <p className="type-label text-xs text-muted">{label}</p>
      <p className="mt-1 font-mono text-[26px] leading-tight font-semibold tabular-nums">{value}</p>
      {(delta || note) && (
        <p className="mt-0.5 text-xs">
          {delta && (
            <span className={t.cls}>
              <span aria-hidden="true">{t.sign}</span>
              <span className="sr-only">{t.label}</span> {delta}
            </span>
          )}{" "}
          {note && <span className="text-muted">{note}</span>}
        </p>
      )}
    </div>
  );
}
