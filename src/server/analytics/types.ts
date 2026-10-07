/** Shape shared by the own (cookieless) analytics and the Matomo adapter. */
export type AnalyticsSummary = {
  provider: "own" | "matomo";
  days: number;
  timezone: string;
  /**
   * visitors = unique visitors per day, summed over the range (own analytics rotates its salt daily,
   * so cross-day uniqueness is unknowable by design; Matomo totals use the same definition).
   */
  totals: { visitors: number; pageviews: number };
  /** One entry per day (oldest first, zero-filled), dates in the shop's time zone. */
  series: { date: string; visitors: number; pageviews: number }[];
  topPages: { path: string; pageviews: number; visitors: number }[];
  topReferrers: { host: string; pageviews: number; visitors: number }[];
  /** Distinct visitors in the last 5 minutes. */
  liveVisitors: number;
};
