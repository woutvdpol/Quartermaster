/*
 * Pure redirect rules (no DB, no server-only) — unit-tested in rules.test.ts.
 *
 *  - Target safety: a redirect only ever points inside the same shop. Stored `toPath` is a relative
 *    path ("/shop?x=1"); same-shop absolute URLs are converted when saved, anything else is refused.
 *    The runtime re-checks every stored target (ETL rows bypass the admin service).
 *  - Loop / chain protection: one hop per request. A target that normalises back to the source,
 *    or whose own redirect points straight back (A → B → A), is dropped at runtime; the admin
 *    service also refuses longer loops (A → B → C → A) and very long chains when saving.
 *  - Built-in Concept500 patterns that need no table row (see builtinLegacyTarget).
 */
import { normalizeRedirectPath, redirectPathOnly } from "./normalize";

export const REDIRECT_STATUS_CODES = [301, 302] as const;
export type RedirectStatusCode = (typeof REDIRECT_STATUS_CODES)[number];

/** Path prefixes a redirect may never take over (admin, API, Next internals, uploaded media). */
const RESERVED_PREFIXES = ["/admin", "/api", "/_next", "/uploads"];

export function isReservedPath(normalized: string): boolean {
  const path = redirectPathOnly(normalized);
  return RESERVED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Is `target` a safe same-origin relative URL to put in a Location header?
 * Must start with exactly one "/" (no "//host", no "/\host"), no backslashes, no control chars,
 * no whitespace, bounded length.
 */
export function isSafeRelativeTarget(target: string): boolean {
  if (typeof target !== "string" || target.length === 0 || target.length > 2000) return false;
  if (!target.startsWith("/")) return false;
  if (target.startsWith("//") || target.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f\s]/.test(target)) return false;
  // Encoded slashes/backslashes right after the leading "/" can be decoded by intermediaries into "//".
  if (/^\/(%2f|%5c)/i.test(target)) return false;
  return true;
}

/**
 * Turns an admin-entered target into the stored relative form, or null when it points elsewhere.
 * Accepts "/path?query#hash" or "path" (→ "/path"), and absolute http(s) URLs whose host is one of
 * `shopHosts` (the tenant's own domains, compared without port and case-insensitively).
 */
export function toSafeTarget(input: string, shopHosts: readonly string[]): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  let out: string;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("//")) {
    let url: URL;
    try {
      url = new URL(s.startsWith("//") ? `https:${s}` : s);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const hosts = new Set(shopHosts.map((h) => h.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "")));
    if (!hosts.has(url.hostname.toLowerCase().replace(/\.$/, ""))) return null;
    out = url.pathname + url.search + url.hash;
  } else {
    out = s.startsWith("/") ? s : `/${s}`;
  }
  return isSafeRelativeTarget(out) ? out : null;
}

export type StoredRedirect = { id: string; fromPath: string; toPath: string; statusCode: number };
export type ResolvedRedirect = { target: string; statusCode: RedirectStatusCode; ids: string[] };
export type RedirectLookup = (key: string) => Promise<StoredRedirect | null>;

/** Normalised key of a target (used to detect self-redirects and loops). */
function targetKey(toPath: string): string | null {
  return normalizeRedirectPath(toPath);
}

function statusOf(code: number): RedirectStatusCode {
  return code === 302 ? 302 : 301;
}

/**
 * Would a request for `targetK` be caught by the row stored under `rowFrom` again?
 * A row without a query catches every query variant of its path; a row with a query only its exact key.
 */
export function pointsBack(rowFrom: string, targetK: string): boolean {
  return rowFrom.includes("?") ? targetK === rowFrom : redirectPathOnly(targetK) === rowFrom;
}

/** Exact key first, then the same path without query (a path row covers all its query variants). */
export async function lookupKey(key: string, lookup: RedirectLookup): Promise<StoredRedirect | null> {
  const exact = await lookup(key);
  if (exact) return exact;
  return key.includes("?") ? lookup(redirectPathOnly(key)) : null;
}

/**
 * Resolves one request key against stored redirects: exactly ONE hop. Returns null when nothing
 * applies, the target is unsafe or points back to itself, or the target's own stored redirect points
 * straight back (A → B → A: both URLs would bounce forever, so serve the 404 instead).
 *
 * Chains (A → B → C) are deliberately NOT flattened: B may be a live page that happens to have a
 * dormant redirect row, and redirects only apply when a URL 404s — so the client follows B itself.
 */
export async function resolveStoredRedirect(key: string, lookup: RedirectLookup): Promise<ResolvedRedirect | null> {
  const first = await lookupKey(key, lookup);
  if (!first || !isSafeRelativeTarget(first.toPath)) return null;
  const k1 = targetKey(first.toPath);
  if (!k1 || k1 === key || pointsBack(first.fromPath, k1)) return null; // never redirect to itself
  const next = await lookupKey(k1, lookup);
  const k2 = next ? targetKey(next.toPath) : null;
  if (k2 && (k2 === key || pointsBack(first.fromPath, k2))) return null; // A → B → A
  return { target: first.toPath, statusCode: statusOf(first.statusCode), ids: [first.id] };
}

/** Hops followed when checking a new redirect for loops (deeper chains are refused as well). */
export const MAX_CHAIN_CHECK = 10;

/**
 * Write-time check for a new/edited redirect `fromKey → toPath`. `lookup` must NOT return the row
 * being edited. Refuses self-redirects, loops (A → B → … → A) and chains deeper than MAX_CHAIN_CHECK.
 * Returns an error message or null.
 */
export async function validateRedirectLink(fromKey: string, toPath: string, lookup: RedirectLookup): Promise<string | null> {
  let k = targetKey(toPath);
  if (!k) return "Enter a valid target path";
  if (pointsBack(fromKey, k)) return "A redirect can't point to itself";
  const seen = new Set<string>([fromKey]);
  for (let hop = 0; hop < MAX_CHAIN_CHECK; hop++) {
    const next = await lookupKey(k, lookup);
    if (!next) return null;
    if (seen.has(next.fromPath)) return "This would create a redirect loop";
    seen.add(next.fromPath);
    const nk = targetKey(next.toPath);
    if (!nk) return null;
    if (pointsBack(fromKey, nk)) return `This would create a loop: ${next.fromPath} already redirects back to ${next.toPath}`;
    k = nk;
  }
  return "This redirect chain is too long — point it to the final page instead";
}

// ─── Built-in Concept500 patterns ───────────────────────────────────────────

/** Old Concept500 paths with a fixed new equivalent (routes/web.php vs src/app/(shop)). */
const STATIC_LEGACY: Record<string, string> = {
  "/basket": "/cart",
  "/profile": "/account/profile",
  "/profile/dashboard": "/account",
  "/profile/orders": "/account/orders",
  "/profile/addresses": "/account/addresses",
  "/profile/address/add": "/account/addresses/new",
  "/profile/wishlist": "/account/wishlist",
  "/checkout/guest": "/checkout",
};

export type BuiltinLegacy =
  | { kind: "path"; target: string }
  /** /shop.php?code=N (old Concept500 product link) → product with stockCode N (decision 26). */
  | { kind: "product"; stockCode: number }
  /** /shop/tag/{name} (tags were looked up by NAME in Concept500). */
  | { kind: "tag"; name: string }
  | null;

/** Recognises a built-in legacy URL from its normalised key (path + cleaned query). */
export function builtinLegacyTarget(key: string): BuiltinLegacy {
  const q = key.indexOf("?");
  const path = q >= 0 ? key.slice(0, q) : key;
  const query = q >= 0 ? new URLSearchParams(key.slice(q + 1)) : new URLSearchParams();

  if (path === "/shop.php") {
    const code = (query.get("code") ?? "").replace(/^#/, "");
    if (!/^\d{1,9}$/.test(code)) return null;
    return { kind: "product", stockCode: Number(code) };
  }
  if (STATIC_LEGACY[path]) return { kind: "path", target: STATIC_LEGACY[path] };
  // /profile/order/{id}: old numeric order ids aren't public URLs anymore → the account order list.
  if (/^\/profile\/order\/[^/]+$/.test(path)) return { kind: "path", target: "/account/orders" };
  const tag = /^\/shop\/tag\/([^/]+)$/.exec(path);
  if (tag) {
    const name = tag[1].trim();
    return name && name.length <= 120 ? { kind: "tag", name } : null;
  }
  return null;
}
