import Link from "next/link";
import { cx } from "@/components/admin/ui";
import { DEFAULT_PERIOD, DEFAULT_STALE_DAYS, INSIGHT_PERIODS, STALE_DAY_OPTIONS, type InsightPeriod } from "@/server/insights/pure";
import { PATH, copy } from "../_copy";

function href(period: InsightPeriod, staleDays: number): string {
  const q = new URLSearchParams();
  if (period !== DEFAULT_PERIOD) q.set("period", period);
  if (staleDays !== DEFAULT_STALE_DAYS) q.set("stale", String(staleDays));
  const s = q.toString();
  return s ? `${PATH}?${s}` : PATH;
}

const segment = (active: boolean) =>
  cx("border-r border-line px-2.5 py-1.5 text-[12.5px] last:border-r-0", active ? "bg-accent text-on-accent" : "text-ink-2 hover:bg-panel-2");

/** Period switch as links (?period=90d|12m|ytd), styled like the segmented control. */
export function PeriodLinks({ period, staleDays }: { period: InsightPeriod; staleDays: number }) {
  return (
    <nav aria-label={copy.periodLegend} className="flex overflow-hidden rounded-control border border-line bg-panel">
      {INSIGHT_PERIODS.map((p) => (
        <Link key={p} href={href(p, staleDays)} aria-current={p === period ? "page" : undefined} className={segment(p === period)}>
          {copy.periods[p]}
        </Link>
      ))}
    </nav>
  );
}

/** "Sitting too long" threshold (?stale=90|180|365). */
export function StaleLinks({ period, staleDays }: { period: InsightPeriod; staleDays: number }) {
  return (
    <nav aria-label={copy.stale.threshold} className="flex items-center gap-2">
      <span>{copy.stale.threshold}</span>
      <span className="flex overflow-hidden rounded-control border border-line bg-panel">
        {STALE_DAY_OPTIONS.map((d) => (
          <Link key={d} href={href(period, d)} aria-current={d === staleDays ? "page" : undefined} className={cx(segment(d === staleDays), "py-1 text-xs")}>
            {copy.stale.thresholdOption(d)}
          </Link>
        ))}
      </span>
    </nav>
  );
}
