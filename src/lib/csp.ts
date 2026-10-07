/*
 * Content-Security-Policy for HTML responses (security review R2). Pure module: used by src/proxy.ts,
 * which generates a fresh nonce per request and puts the policy on both the response and the
 * *request* headers — Next reads the nonce from the request's `Content-Security-Policy` (or
 * `-Report-Only`) header during SSR and stamps it on its own bootstrap/inline scripts
 * (node_modules/next/dist/server/route-modules/app-page/parse-request-headers.js).
 *
 * Rendering impact: a nonce only reaches pages that render per request. Every shop/admin/platform page
 * already does (the shop layout reads the Host header, the admin layout reads cookies), so nothing
 * changes there. The only prerendered HTML is Next's built-in `/_not-found` and `/_global-error`;
 * their scripts carry no nonce and would be blocked when enforced (the HTML itself still shows).
 * `/_not-found` is practically unreachable (the `/:path+` fallback rewrite renders the shop 404).
 *
 * Policy decisions (see docs/04-security-review.md R2):
 *  - script-src: nonce + 'strict-dynamic' — only Next's nonce'd scripts run; scripts they insert
 *    (route chunks, the Cloudflare Turnstile loader) are trusted transitively. 'self' and the
 *    Turnstile origin are fallbacks for browsers without 'strict-dynamic' (ignored by modern ones).
 *    JSON-LD `<script type="application/ld+json">` is a data block, not subject to script-src.
 *    Dev only: 'unsafe-eval' (React reconstructs server stacks with eval).
 *  - style-src 'unsafe-inline': React `style={…}` props become style attributes (theme variables on
 *    the shop root, progress bars, …) and the newsletter preview iframe (srcdoc inherits this policy)
 *    has an inline <style>. A nonce on style-src would disable 'unsafe-inline' and break those.
 *  - img-src data: (blur placeholders), blob: (upload previews). Admin also https: — the newsletter
 *    preview (sandboxed srcdoc iframe, inherits this policy) shows external images from the markdown.
 *  - form-action: Mollie hosted checkout — without JS the checkout form POST is answered with a
 *    303 to www.mollie.com, and form-action also applies to redirects after a form submission.
 *  - Matomo is used server-side only (reporting API); no browser script/beacon → nothing to allow.
 *  - frame-ancestors mirrors X-Frame-Options (admin 'none' = DENY, shop 'self' = SAMEORIGIN).
 *    Browsers ignore frame-ancestors in report-only policies; X-Frame-Options keeps enforcing.
 *  - No upgrade-insecure-requests: TLS ends at the ingress (HSTS there, R8), and it would break
 *    plain-http local `next start`.
 */

export type CspMode = "report-only" | "enforce" | "off";
export type CspArea = "shop" | "admin";

export const CSP_REPORT_PATH = "/api/csp-report";
export const CSP_REPORT_GROUP = "csp-endpoint";

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
export const MOLLIE_CHECKOUT_ORIGIN = "https://www.mollie.com";

/** `CSP_MODE` env: "report-only" (default, also for unknown values), "enforce" or "off". */
export function parseCspMode(raw: string | undefined): CspMode {
  const value = raw?.trim().toLowerCase();
  if (value === "enforce" || value === "off") return value;
  return "report-only";
}

/** 128-bit random nonce, base64. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export type CspOptions = {
  nonce: string;
  area: CspArea;
  /** Adds what `next dev` needs ('unsafe-eval'). */
  dev?: boolean;
};

export function buildCsp({ nonce, area, dev = false }: CspOptions): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", TURNSTILE_ORIGIN, ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...(area === "admin" ? ["https:"] : [])],
    "font-src": ["'self'"],
    "connect-src": ["'self'"],
    "frame-src": ["'self'", TURNSTILE_ORIGIN],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", MOLLIE_CHECKOUT_ORIGIN],
    "frame-ancestors": [area === "admin" ? "'none'" : "'self'"],
    "report-uri": [CSP_REPORT_PATH],
    "report-to": [CSP_REPORT_GROUP],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

export function cspHeaderName(mode: Exclude<CspMode, "off">): string {
  return mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}

/** `Reporting-Endpoints` value for the `report-to` group (Reporting API v1; relative to the page). */
export function reportingEndpointsHeader(): string {
  return `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;
}
