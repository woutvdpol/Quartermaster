import { fold } from "@/server/search/normalize";

/* URL parameters of the network search page (pure; unit-tested). */

export const NETWORK_PAGE_SIZE = 24;
export const NETWORK_MAX_QUERY = 120;
const MAX_LIST = 12;

export type NetworkSort = "relevance" | "newest";

export type NetworkSearchParams = {
  q: string;
  /** Dealer (tenant) slugs; empty = all dealers. */
  dealers: string[];
  /** Only dealers that ship to the visitor's country. */
  ships: boolean;
  /** Folded top-level PERIOD / COUNTRY value names. */
  period: string[];
  country: string[];
  sort: NetworkSort;
  page: number;
};

type Raw = Record<string, string | string[] | undefined>;

const list = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

function keys(v: string | string[] | undefined, clean: (s: string) => string): string[] {
  return [...new Set(list(v).map((s) => clean(s.slice(0, 80))).filter(Boolean))].slice(0, MAX_LIST).sort();
}

export function parseNetworkParams(raw: Raw): NetworkSearchParams {
  const q = (list(raw.q)[0] ?? "").replace(/\s+/g, " ").trim().slice(0, NETWORK_MAX_QUERY);
  const page = Number.parseInt(list(raw.page)[0] ?? "1", 10);
  const sort = list(raw.sort)[0];
  return {
    q,
    dealers: keys(raw.dealer, (s) => (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) ? s : "")),
    ships: list(raw.ships)[0] === "1",
    period: keys(raw.period, fold),
    country: keys(raw.country, fold),
    // Without a query there is nothing to rank: newest first.
    sort: q && sort !== "newest" ? "relevance" : "newest",
    page: Number.isFinite(page) && page >= 1 && page <= 50 ? page : 1,
  };
}

/** Query string for a params object (stable order, defaults left out). */
export function networkQueryString(p: Partial<NetworkSearchParams>): string {
  const sp = new URLSearchParams();
  if (p.q) sp.set("q", p.q);
  for (const d of p.dealers ?? []) sp.append("dealer", d);
  if (p.ships) sp.set("ships", "1");
  for (const v of p.period ?? []) sp.append("period", v);
  for (const v of p.country ?? []) sp.append("country", v);
  if (p.q && p.sort === "newest") sp.set("sort", "newest");
  if (p.page && p.page > 1) sp.set("page", String(p.page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
