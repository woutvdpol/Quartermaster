import { createHash, createHmac } from "node:crypto";

/*
 * Cookieless page-view collection helpers (pure; no DB, no Next APIs — unit-tested).
 *
 * Privacy model
 * - No cookies, no client ids, no raw IP or user agent stored.
 * - visitorHash = sha256(dailySalt ‖ ip ‖ ua ‖ tenantId), truncated to 128 bits.
 * - dailySalt = HMAC-SHA256(APP_ENCRYPTION_KEY, "qm-analytics:" + local date of the tenant).
 *   The salt is never stored and changes every (tenant-local) day, so the same visitor cannot be
 *   linked across days or across shops. Consequence: "unique visitors" over a range = visitor-days.
 *   Note: the salt is *derived*, so whoever holds APP_ENCRYPTION_KEY plus a candidate IP+UA can
 *   recompute a hash; it protects against database-only leaks, not against a key holder.
 */

const SALT_CONTEXT = "qm-analytics:";

function encryptionKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes (base64)");
  return buf;
}

/** "YYYY-MM-DD" of `at` in `timeZone`. */
export function localDateKey(at: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function dailySalt(dateKey: string, key: Buffer = encryptionKey()): Buffer {
  return createHmac("sha256", key).update(SALT_CONTEXT + dateKey).digest();
}

export function visitorHash(input: {
  ip: string | null;
  userAgent: string | null;
  tenantId: string;
  at: Date;
  timeZone: string;
  key?: Buffer;
}): string {
  const salt = dailySalt(localDateKey(input.at, input.timeZone), input.key);
  return createHash("sha256")
    .update(salt)
    .update("\0")
    .update(input.ip ?? "")
    .update("\0")
    .update(input.userAgent ?? "")
    .update("\0")
    .update(input.tenantId)
    .digest("hex")
    .slice(0, 32);
}

// ─── Bot filter ─────────────────────────────────────────────────────────────

const BOT_RE =
  /bot\b|bot\/|crawl|spider|slurp|scrap|fetch|preview|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|statuscake|check_http|curl|wget|python|httpie|httpclient|okhttp|axios|node-fetch|undici|go-http|java\/|libwww|perl|ruby|php\/|guzzle|postman|insomnia|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|skype|embedly|quora link|bitlybot|vkshare|w3c_validator|phantomjs|selenium|puppeteer|playwright|cypress|electron\/|chrome-lighthouse|bingpreview|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|anthropic|ccbot|perplexity|applebot|amazonbot|dataforseo|archive\.org/i;

/** True for crawlers, link previewers, monitoring tools, HTTP libraries and empty/odd user agents. */
export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  const ua = userAgent.trim();
  if (ua.length < 20 || ua.length > 1000) return true;
  // Real browsers all announce "Mozilla/5.0 (".
  if (!/^Mozilla\/5\.0 \(/.test(ua)) return true;
  return BOT_RE.test(ua);
}

// ─── Path / referrer / country normalization ────────────────────────────────

const EXCLUDED_PREFIXES = ["/admin", "/api", "/_next", "/uploads"];
const MAX_PATH = 500;

/**
 * Normalizes a storefront path for storage: drops the fragment and every query parameter except
 * `utm_*` (kept in their original order), collapses duplicate slashes, removes a trailing slash.
 * Returns null for invalid input or non-storefront paths (admin, api, assets).
 * Accepts a path ("/shop?x=1") or an absolute http(s) URL (only its path+query are used).
 */
export function normalizePath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 2000) return null;
  let url: URL;
  try {
    if (raw.startsWith("/") && !raw.startsWith("//")) url = new URL(raw, "http://x.invalid");
    else if (/^https?:\/\//i.test(raw)) url = new URL(raw);
    else return null;
  } catch {
    return null;
  }

  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  const lower = path.toLowerCase();
  if (EXCLUDED_PREFIXES.some((p) => lower === p || lower.startsWith(`${p}/`))) return null;

  const utm = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (/^utm_[a-z]+$/i.test(k) && v) utm.append(k.toLowerCase(), v.slice(0, 100));
  }
  const query = utm.toString();
  const result = query ? `${path}?${query}` : path;
  return result.length > MAX_PATH ? result.slice(0, MAX_PATH) : result;
}

/** Path without its query string (for grouping top pages). */
export function basePath(path: string): string {
  const i = path.indexOf("?");
  return i === -1 ? path : path.slice(0, i);
}

/**
 * Host of an external referrer, lower-case without "www.". Null for invalid/non-http referrers and
 * internal navigation (same host as the shop).
 */
export function referrerHost(referrer: unknown, ownHost: string | null): string | null {
  if (typeof referrer !== "string" || !referrer || referrer.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  const own = ownHost?.toLowerCase().split(":")[0].replace(/^www\./, "") ?? null;
  const bare = host.replace(/^www\./, "");
  if (own && bare === own) return null;
  return bare.slice(0, 253);
}

/** ISO country from CDN headers (Cloudflare / Vercel). Ignores unknown/Tor markers. */
export function countryFromHeaders(headers: Headers): string | null {
  const raw = headers.get("cf-ipcountry") ?? headers.get("x-vercel-ip-country");
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return null;
  return code;
}

/** First hop of X-Forwarded-For, else X-Real-IP. Only meaningful behind a trusted proxy. */
export function clientIp(headers: Headers): string | null {
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || null;
  return ip ? ip.slice(0, 100) : null;
}

// ─── In-memory rate limit ───────────────────────────────────────────────────

/**
 * Fixed-window counter per key, kept in process memory: a page view must not cost extra DB writes.
 * Per-instance only (good enough to stop a single client flooding; not a security boundary).
 */
export class MemoryRateLimiter {
  private hits = new Map<string, { windowStart: number; count: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
  ) {}

  /** Records a hit; returns false when the key is over the limit. */
  take(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      if (this.hits.size >= this.maxKeys) this.sweep(now);
      this.hits.set(key, { windowStart: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  private sweep(now: number) {
    for (const [k, v] of this.hits) if (now - v.windowStart >= this.windowMs) this.hits.delete(k);
    // Still full (flood of distinct keys): start over rather than grow without bound.
    if (this.hits.size >= this.maxKeys) this.hits.clear();
  }

  reset() {
    this.hits.clear();
  }
}
