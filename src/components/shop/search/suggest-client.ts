import type { SuggestResponse } from "@/server/search/api-types";

/*
 * Client side of search-as-you-type: GET /api/search/suggest with one request in flight (a newer
 * query aborts the older one) and a small per-tab cache keyed by the normalised query, so typing
 * back ("helm" → "helme" → "helm") or reopening the dropdown costs no request. Pure apart from
 * `fetch` (injectable for tests: suggest-client.test.ts). Debouncing is the caller's job.
 */

export const SUGGEST_MIN_CHARS = 2;
export const SUGGEST_DEBOUNCE_MS = 120;
const MAX_QUERY = 100;

export const normalizeQuery = (q: string) => q.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);

export type SuggestClient = {
  /** Cached response for this query, if any (no request). */
  peek(q: string): SuggestResponse | undefined;
  /** Fetches (or returns the cached) suggestions; null when aborted by a newer call or failed. */
  get(q: string): Promise<SuggestResponse | null>;
  /** Aborts the request in flight. */
  abort(): void;
};

export function createSuggestClient({ fetchFn = (...a: Parameters<typeof fetch>) => fetch(...a), endpoint = "/api/search/suggest", max = 40 } = {}): SuggestClient {
  const cache = new Map<string, SuggestResponse>();
  let inflight: AbortController | null = null;
  const remember = (key: string, value: SuggestResponse) => {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > max) cache.delete(cache.keys().next().value as string);
  };
  return {
    peek: (q) => cache.get(normalizeQuery(q).toLowerCase()),
    abort() {
      inflight?.abort();
      inflight = null;
    },
    async get(q) {
      const query = normalizeQuery(q);
      const key = query.toLowerCase();
      const hit = cache.get(key);
      if (hit) return hit;
      inflight?.abort();
      const ctrl = new AbortController();
      inflight = ctrl;
      try {
        const res = await fetchFn(`${endpoint}?q=${encodeURIComponent(query)}`, { signal: ctrl.signal, headers: { accept: "application/json" } });
        if (!res.ok) return null;
        const data = (await res.json()) as SuggestResponse;
        remember(key, data);
        return ctrl.signal.aborted ? null : data;
      } catch {
        return null; // aborted (a newer query is on its way) or offline: the form still submits
      } finally {
        if (inflight === ctrl) inflight = null;
      }
    },
  };
}
