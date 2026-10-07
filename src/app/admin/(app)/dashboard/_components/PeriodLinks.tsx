import Link from "next/link";
import { cx } from "@/components/admin/ui";
import { PERIODS, copy } from "../_copy";

/** Period switch as links (?days=7|30|90), styled like the segmented control. */
export function PeriodLinks({ active }: { active: number }) {
  return (
    <nav aria-label={copy.periodLegend} className="flex overflow-hidden rounded-control border border-line bg-panel">
      {PERIODS.map((d) => (
        <Link
          key={d}
          href={d === 30 ? "/admin/dashboard" : `/admin/dashboard?days=${d}`}
          aria-current={d === active ? "page" : undefined}
          className={cx(
            "border-r border-line px-2.5 py-1.5 text-[12.5px] last:border-r-0",
            d === active ? "bg-accent text-on-accent" : "text-ink-2 hover:bg-panel-2",
          )}
        >
          {copy.periodOption(d)}
        </Link>
      ))}
    </nav>
  );
}
