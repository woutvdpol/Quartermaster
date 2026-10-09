/** "Jul 2026" in the shop's time zone (sold dates in the duplicate panel and lineage note). */
export function monthLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone }).format(date);
}
