/*
 * Redirect path normalisation — pure, shared by the runtime lookup, the admin service and the
 * Concept500 ETL (scripts/etl). Both sides MUST normalise with this function so a stored
 * `Redirect.fromPath` matches the key computed for an incoming request.
 *
 * Normal form:
 *   - path only: scheme/host of a full URL and any `#fragment` are dropped
 *   - leading "/", no trailing "/" (except the root "/"), repeated slashes collapsed
 *   - percent-decoded where safe (decodeURI: reserved characters like %2F / %3F stay encoded)
 *   - lower-case (path and query)
 *   - query string kept (for query-based legacy links like "/shop.php?code=123"), with tracking
 *     parameters (utm_*, gclid, fbclid, …) and empty values removed and parameters sorted, so
 *     "?b=2&a=1&utm_source=x" and "?a=1&b=2" give the same key. An empty query is dropped.
 */

/** Query parameters that never identify a page (marketing / click tracking). */
const TRACKING_PARAMS = new Set(["gclid", "fbclid", "msclkid", "dclid", "yclid", "_ga", "_gl", "mc_cid", "mc_eid", "ref"]);

function isTrackingParam(name: string): boolean {
  return name.startsWith("utm_") || TRACKING_PARAMS.has(name);
}

/** Max length of a normalised path (keeps junk out of the table and the cache key). */
export const MAX_REDIRECT_PATH_LENGTH = 1000;

export type NormalizeOptions = {
  /** Keep the (cleaned) query string. Default true. */
  keepQuery?: boolean;
};

function safeDecode(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s; // malformed escape — keep as-is
  }
}

/**
 * Normalises a path or URL to the redirect key form. Returns `null` for input that can't be a
 * same-shop path (empty, protocol-relative "//host", non-http(s) scheme, too long, control chars).
 */
export function normalizeRedirectPath(input: string, options: NormalizeOptions = {}): string | null {
  const keepQuery = options.keepQuery ?? true;
  let s = (input ?? "").trim();
  if (!s) return null;
  // Control characters (incl. tabs/newlines) are never legitimate. Inner spaces are allowed: a
  // decoded "%20" is a space, so the normal form must accept it again (idempotence).
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;

  // Full URL → keep path + query only (old links may be stored with the Concept500 domain).
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (scheme) {
    if (!/^https?$/i.test(scheme[1])) return null;
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      return null;
    }
    s = url.pathname + url.search;
  } else if (s.startsWith("//") || s.startsWith("\\")) {
    return null; // protocol-relative URL, not a path
  }

  const hash = s.indexOf("#");
  if (hash >= 0) s = s.slice(0, hash);
  const q = s.indexOf("?");
  let path = q >= 0 ? s.slice(0, q) : s;
  const query = q >= 0 ? s.slice(q + 1) : "";

  path = safeDecode(path).toLowerCase().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, "") || "/";

  let out = path;
  if (keepQuery && query) {
    const pairs: string[] = [];
    for (const part of query.split("&")) {
      if (!part) continue;
      const eq = part.indexOf("=");
      const name = safeDecode(eq >= 0 ? part.slice(0, eq) : part).toLowerCase();
      const value = safeDecode(eq >= 0 ? part.slice(eq + 1) : "").toLowerCase();
      if (!name || !value || isTrackingParam(name)) continue;
      pairs.push(`${name}=${value}`);
    }
    pairs.sort();
    if (pairs.length) out = `${path}?${pairs.join("&")}`;
  }

  if (out.length > MAX_REDIRECT_PATH_LENGTH) return null;
  return out;
}

/** The path part (no query) of a normalised key. */
export function redirectPathOnly(normalized: string): string {
  const q = normalized.indexOf("?");
  return q >= 0 ? normalized.slice(0, q) : normalized;
}
