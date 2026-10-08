import { TtlLru } from "./lru";

/*
 * In-process sliding-window throttle for search-as-you-type (per client IP, per web process):
 * 30 requests per 10 s ≈ fast typing with a debounce, three tabs at once. Cheap (no DB round trip),
 * deliberately loose — it stops scripts hammering one pod, not distributed abuse.
 */
const WINDOW_MS = 10_000;
const LIMIT = 30;
const hits = new TtlLru<number[]>(10_000, WINDOW_MS);

export function allowSuggest(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

/** Tests. */
export function resetSuggestThrottle(): void {
  hits.clear();
}
