import { isIP } from "node:net";

/*
 * Client IP and host of the current request — the ONLY place that reads proxy headers.
 *
 * What Next 16 gives us: no socket address (NextRequest.ip is gone since Next 15, Server Actions
 * and RSC only see headers). Next's own Node server does `x-forwarded-for ??= socket.remoteAddress`
 * (node_modules/next/dist/server/base-server.js), i.e. it only fills the header when the client did
 * NOT send one — so a client-supplied X-Forwarded-For reaches us untouched and cannot be told apart
 * from the socket address.
 *
 * Therefore the header is trusted per hop count, set by the deployment (env `TRUSTED_PROXY_HOPS`):
 * - 0 (default): no trusted proxy in front of the app. X-Forwarded-For / X-Real-IP are ignored
 *   entirely and the IP is unknown (null). Rate limits then fall back to per-account / global keys.
 *   Fine for local development; production must run behind a proxy and set the hop count.
 * - N ≥ 1: N trusted proxies each append the address they received the request from (ingress-nginx
 *   does this). The client is the N-th entry from the right; everything left of it may be forged
 *   by the client and is ignored. Example (N=1): "forged, 203.0.113.7" → 203.0.113.7.
 *   Behind a cloud load balancer that also appends (LB → ingress-nginx → app), use N=2.
 *   X-Real-IP is ignored: XFF from a trusted chain carries the same information, and a single
 *   header set "by the proxy" can't be distinguished from one set by the client when the proxy
 *   doesn't overwrite it.
 *
 * Host: tenant resolution and same-origin checks use the `Host` header only. X-Forwarded-Host is
 * ignored on purpose: Next fills it from Host when absent but passes a client-supplied value
 * through, so trusting it would let any client pick a tenant / satisfy an Origin check.
 * ingress-nginx forwards the original Host unchanged, so Host is correct behind it.
 */

const MAX_HOPS = 10;

/** Parsed `TRUSTED_PROXY_HOPS`; invalid values fall back to 0 (trust nothing). Read per call (tests). */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const raw = env.TRUSTED_PROXY_HOPS?.trim();
  if (!raw) return 0;
  if (!/^\d+$/.test(raw)) return 0;
  return Math.min(Number(raw), MAX_HOPS);
}

/** Canonical IP literal or null. Strips IPv4-mapped IPv6 prefixes, brackets and IPv4 ports. */
export function normalizeIp(input: string | null | undefined): string | null {
  let ip = input?.trim();
  if (!ip) return null;
  if (ip.startsWith("[")) ip = ip.slice(1, ip.indexOf("]") === -1 ? undefined : ip.indexOf("]")); // "[::1]:443"
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":")); // "1.2.3.4:5678"
  if (/^::ffff:\d{1,3}(\.\d{1,3}){3}$/i.test(ip)) ip = ip.slice(7);
  const v = isIP(ip);
  if (v === 0) return null;
  return v === 6 ? ip.toLowerCase() : ip;
}

let warnedNoProxy = false;

/** The client IP according to the trusted proxy chain, or null when unknown / not trustworthy. */
export function clientIpFromHeaders(h: Pick<Headers, "get">, hops = trustedProxyHops()): string | null {
  if (hops <= 0) {
    if (!warnedNoProxy && process.env.NODE_ENV === "production" && h.get("x-forwarded-for")) {
      warnedNoProxy = true;
      console.warn("[request-meta] X-Forwarded-For received but TRUSTED_PROXY_HOPS=0: client IPs are ignored (per-IP rate limits degrade). Set TRUSTED_PROXY_HOPS.");
    }
    return null;
  }
  const xff = h.get("x-forwarded-for");
  if (!xff) return null;
  const entries = xff.split(",").map((s) => s.trim()).filter(Boolean);
  if (entries.length < hops) return null; // chain shorter than the configured proxies: misconfigured
  return normalizeIp(entries[entries.length - hops]);
}

/** Host header, lower-cased, without trailing dot. Never X-Forwarded-Host (see header comment). */
export function requestHost(h: Pick<Headers, "get">): string {
  return (h.get("host") ?? "").trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Client IP of the current request via next/headers; null outside a request scope (scripts, worker,
 * tests) or when untrusted.
 */
export async function requestClientIp(): Promise<string | null> {
  try {
    // Lazy import keeps the rest of this module pure (unit tests, analytics helpers). Outside a
    // request Next 16's headers() throws synchronously; the try covers both forms.
    const { headers } = await import("next/headers");
    return clientIpFromHeaders(await headers());
  } catch {
    return null;
  }
}

/**
 * CSRF guard for POST route handlers (Server Actions have Next's built-in Origin check): the
 * browser-set Origin must match the Host the request was sent to. Requests without Origin fail.
 */
export function isSameOrigin(request: Pick<Request, "headers">): boolean {
  const origin = request.headers.get("origin");
  const host = requestHost(request.headers);
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}
