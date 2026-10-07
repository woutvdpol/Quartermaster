import { DateTime, KpiCard, cx } from "@/components/admin/ui";
import { copy } from "../_copy";
import { formatCount } from "./format";

const t = copy.stats;

export type QuotaInfo = {
  quota: number;
  unlimited: boolean;
  used: number;
  remaining: number | null;
  periodEnd: Date;
};

/** Header stats: subscriber counts plus the monthly sending quota with a meter. */
export function StatsStrip({
  counts,
  quota,
  timeZone,
}: {
  counts: { active: number; pending: number; unsubscribed: number };
  quota: QuotaInfo;
  timeZone: string;
}) {
  return (
    <section
      aria-label={t.label}
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      <KpiCard
        label={t.confirmed}
        value={formatCount(counts.active)}
        note={t.confirmedNote}
      />
      <KpiCard
        label={t.pending}
        value={formatCount(counts.pending)}
        note={t.pendingNote}
      />
      <KpiCard
        label={t.unsubscribed}
        value={formatCount(counts.unsubscribed)}
        note={t.unsubscribedNote}
      />
      <QuotaCard quota={quota} timeZone={timeZone} />
    </section>
  );
}

function QuotaCard({
  quota,
  timeZone,
}: {
  quota: QuotaInfo;
  timeZone: string;
}) {
  const pct =
    quota.unlimited || quota.quota <= 0
      ? 0
      : Math.min(100, Math.round((quota.used / quota.quota) * 100));
  const tone = pct >= 100 ? "bg-crit" : pct >= 80 ? "bg-warn" : "bg-accent";
  return (
    <div className="rounded-card border border-line bg-panel p-3.5 shadow-card">
      <p className="type-label text-xs text-muted">{t.quota}</p>
      <p className="mt-1 font-mono text-[26px] leading-tight font-semibold tabular-nums">
        {quota.unlimited ? t.unlimited : `${pct}%`}
      </p>
      {!quota.unlimited && (
        <div
          role="meter"
          aria-label={t.meterLabel}
          aria-valuemin={0}
          aria-valuemax={quota.quota}
          aria-valuenow={Math.min(quota.used, quota.quota)}
          aria-valuetext={t.quotaUsed(
            formatCount(quota.used),
            formatCount(quota.quota),
          )}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-2 ring-1 ring-line ring-inset"
        >
          <div
            className={cx("h-full rounded-full", tone)}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <p className="mt-1.5 text-xs text-muted">
        {quota.unlimited
          ? t.quotaUnlimited(formatCount(quota.used))
          : t.quotaUsed(formatCount(quota.used), formatCount(quota.quota))}
        {" · "}
        {t.quotaPeriod}{" "}
        <DateTime value={quota.periodEnd} format="date" timeZone={timeZone} />
      </p>
    </div>
  );
}
