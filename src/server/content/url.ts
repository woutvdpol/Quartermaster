/**
 * URL sanitizer for everything a shop owner can type as a link (block buttons, Markdown links, menus).
 * Pure (no DB, no `server-only`) so admin client components can reuse it for inline validation.
 *
 * Allowed:
 *  - absolute `http:` / `https:` URLs with a host
 *  - `mailto:` with an address
 *  - relative URLs: `/path`, `?query`, `#anchor` and bare relative paths (`page`, `page/sub`)
 * Rejected: every other scheme (`javascript:`, `data:`, `vbscript:`, `file:`, …), protocol-relative
 * `//host` and `/\host` (browsers treat both as another origin), control characters and whitespace
 * tricks used to smuggle a scheme past naive checks (`java\tscript:`), and URLs over 2048 chars.
 */

export const MAX_URL_LENGTH = 2048;

// C0 controls, DEL and the C1 range; also zero-width / bidi characters browsers silently strip.
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\uFEFF]/;

export type UrlKind = "absolute" | "mailto" | "relative";

/** Returns the trimmed, safe URL, or null when it is not allowed. */
export function sanitizeUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const url = input.trim();
  if (!url || url.length > MAX_URL_LENGTH) return null;
  if (INVISIBLE.test(url) || /\s/.test(url)) return null;
  // Anything with a backslash is ambiguous between browsers (`/\evil.com`, `https:\\evil.com`).
  if (url.includes("\\")) return null;
  if (url.startsWith("//")) return null;

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  if (!scheme) {
    // No scheme before the first ":" — but a ":" before any "/", "?" or "#" would be read as a scheme
    // by browsers when it does not match the regex above (e.g. "1javascript:"), so reject that.
    const firstColon = url.indexOf(":");
    if (firstColon !== -1) {
      const firstDelim = url.search(/[/?#]/);
      if (firstDelim === -1 || firstColon < firstDelim) return null;
    }
    return url;
  }

  const protocol = scheme[1].toLowerCase();
  if (protocol === "mailto") {
    return /^mailto:[^@\s]+@[^@\s]+$/i.test(url.split("?")[0]) ? url : null;
  }
  if (protocol !== "http" && protocol !== "https") return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return null;
    if (parsed.username || parsed.password) return null; // https://shop.com@evil.com phishing
  } catch {
    return null;
  }
  return url;
}

export function isSafeUrl(input: unknown): input is string {
  return sanitizeUrl(input) !== null;
}

export function urlKind(url: string): UrlKind {
  if (/^mailto:/i.test(url)) return "mailto";
  if (/^https?:/i.test(url)) return "absolute";
  return "relative";
}

/** True for links that leave the shop (rendered with rel="noopener noreferrer"). */
export function isExternalUrl(url: string): boolean {
  return urlKind(url) === "absolute";
}
