/*
 * URL helpers for list screens. Pages receive `searchParams` as a Promise (Next 16); await it and
 * pass the plain object to the URL-driven components (Pagination, ViewTabs, FilterChip, SortLink).
 */

export type SearchParamsRecord = Record<string, string | string[] | undefined>;
export type SearchParamsInput = SearchParamsRecord | URLSearchParams;

/** Value of a patch entry: `null`/`undefined`/"" remove the parameter. */
export type ParamPatch = Record<string, string | number | null | undefined>;

function toURLSearchParams(input: SearchParamsInput): URLSearchParams {
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  return params;
}

/** Build `basePath?…` from the current params plus a patch. Keeps all unrelated params. */
export function hrefWith(basePath: string, current: SearchParamsInput, patch: ParamPatch): string {
  const params = toURLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/** First value of a search param, or undefined. */
export function getParam(current: SearchParamsInput, key: string): string | undefined {
  if (current instanceof URLSearchParams) return current.get(key) ?? undefined;
  const value = current[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Parse a positive page number from a search param (defaults to 1). */
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export type SortState<K extends string = string> = { key: K; dir: "asc" | "desc" };

/** Parse `?sort=price` (ascending) / `?sort=-price` (descending), limited to allowed keys. */
export function parseSort<K extends string>(value: string | string[] | undefined, allowed: readonly K[]): SortState<K> | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const dir = raw.startsWith("-") ? "desc" : "asc";
  const key = raw.replace(/^-/, "");
  return (allowed as readonly string[]).includes(key) ? { key: key as K, dir } : null;
}
