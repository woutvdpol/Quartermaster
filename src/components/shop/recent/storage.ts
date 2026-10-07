/*
 * "Recently viewed" — client-side only. Product ids live in localStorage per shop host; nothing is
 * sent anywhere except the ids the strip asks cards for. Every storage access is wrapped in
 * try/catch (private mode, blocked storage, quota) and silently degrades to "nothing viewed".
 */

export const RECENT_MAX = 12;
const KEY_PREFIX = "qm:recent:";
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Subset of the Web Storage API (injectable for tests). */
export type RecentStorage = Pick<Storage, "getItem" | "setItem">;

export function recentKey(host: string): string {
  return `${KEY_PREFIX}${host.toLowerCase()}`;
}

export function isRecentId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

/** Parses a stored value into a clean, de-duplicated id list (newest first, max RECENT_MAX). */
export function parseRecent(raw: string | null): string[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: string[] = [];
  for (const v of data) {
    if (isRecentId(v) && !out.includes(v)) out.push(v);
    if (out.length >= RECENT_MAX) break;
  }
  return out;
}

/** Moves `id` to the front, de-duplicates and caps the list. Pure. */
export function addRecent(list: readonly string[], id: string): string[] {
  if (!isRecentId(id)) return [...list];
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENT_MAX);
}

function defaultStorage(): RecentStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readRecent(host: string, storage: RecentStorage | null = defaultStorage()): string[] {
  if (!storage) return [];
  try {
    return parseRecent(storage.getItem(recentKey(host)));
  } catch {
    return [];
  }
}

/** Records a view; returns the new list (or the unchanged list when storage fails). */
export function pushRecent(host: string, id: string, storage: RecentStorage | null = defaultStorage()): string[] {
  const current = readRecent(host, storage);
  const next = addRecent(current, id);
  if (!storage) return next;
  try {
    storage.setItem(recentKey(host), JSON.stringify(next));
  } catch {
    // Quota / blocked storage: ignore.
  }
  return next;
}
