import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { DEFAULT_TIME_ZONE, formatDate, formatRelative, toDate, type DateFormat, type DateInputValue } from "./date-utils";
import { DEFAULT_FORMAT_LOCALE } from "./money-utils";

const t = getDictionary().ui.dateTime;

type DateTimeProps = {
  value: DateInputValue | null | undefined;
  /**
   * "relative" ("3 hours ago"), "date", "datetime" (default), "time", "long".
   * The full date and time is always available in the title tooltip.
   */
  format?: DateFormat | "relative";
  /** IANA zone, normally Tenant.timezone. */
  timeZone?: string;
  locale?: string;
  /** Reference time for relative output (defaults to now; pass one value for a whole list). */
  now?: Date;
  className?: string;
};

/**
 * <time> with a machine-readable dateTime and absolute title. Server-component friendly; relative
 * output is computed at render time, so prefer it in server components (no hydration drift).
 */
export function DateTime({
  value,
  format = "datetime",
  timeZone = DEFAULT_TIME_ZONE,
  locale = DEFAULT_FORMAT_LOCALE,
  now,
  className,
}: DateTimeProps) {
  const date = value === null || value === undefined ? null : toDate(value);
  if (!date) return <span className={cx("text-muted", className)}>{t.none}</span>;
  const absolute = formatDate(date, "long", timeZone, locale);
  const text = format === "relative" ? formatRelative(date, now, locale) : formatDate(date, format, timeZone, locale);
  return (
    <time dateTime={date.toISOString()} title={absolute} suppressHydrationWarning className={cx("whitespace-nowrap", className)}>
      {text}
    </time>
  );
}
