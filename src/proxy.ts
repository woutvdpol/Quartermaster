// Next 16 proxy (formerly middleware). Optimistic checks only — no DB access here.
// Real authorization happens in server code (src/server/auth/guards.ts).
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, createNonce, cspHeaderName, parseCspMode, reportingEndpointsHeader } from "@/lib/csp";
import { networkRewritePath, platformNetworkRedirect } from "@/lib/network";
import { LOCALE_HEADER, isLocalizablePath, splitLocalePath } from "@/lib/i18n/shop-locales";
import { THEME_PREVIEW_COOKIE, THEME_PREVIEW_HEADER, THEME_PREVIEW_MAX_AGE_SECONDS, THEME_PREVIEW_PARAM } from "@/lib/theme-preview";

// Keep in sync with SESSION_COOKIE in src/server/auth/session.ts (that module is server-only).
const SESSION_COOKIE = "qm_session";

/** Admin paths reachable without a session cookie (prefix match on a path segment boundary). */
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/forgot-password", "/admin/reset-password", "/admin/accept-invite"];

const SECURITY_HEADERS: Record<string, string> = {
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
};

function normalizeHost(host: string | null): string {
  return (host ?? "").trim().toLowerCase().replace(/\.$/, "");
}

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

const CSP_REQUEST_HEADERS = ["content-security-policy", "content-security-policy-report-only", "x-nonce"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isAdmin = isUnder(pathname, "/admin");

  // CSP (review R2, src/lib/csp.ts). CSP_MODE is read per request: report-only (default) | enforce | off.
  const cspMode = parseCspMode(process.env.CSP_MODE);
  const nonce = cspMode === "off" ? null : createNonce();
  const csp = nonce
    ? buildCsp({ nonce, area: isAdmin ? "admin" : "shop", dev: process.env.NODE_ENV === "development" })
    : null;

  // Theme preview (src/lib/theme-preview.ts): only a request flag here; the shop checks the staff session.
  const previewParam = isAdmin ? null : request.nextUrl.searchParams.get(THEME_PREVIEW_PARAM);
  const previewOn =
    !isAdmin && (previewParam === "1" || (previewParam !== "0" && request.cookies.get(THEME_PREVIEW_COOKIE)?.value === "1"));

  // Shop languages (docs/i18n.md § Shop-routing): "/de/x" is served by the route "/x" with LOCALE_HEADER
  // set; English has no prefix, so "/en/x" 308s to "/x". Not on the network host nor for admin/API/files.
  const networkHost = normalizeHost(process.env.NETWORK_HOST ?? null);
  const onNetworkHost = !!networkHost && normalizeHost(request.headers.get("host")) === networkHost;
  const localePath = isAdmin || onNetworkHost ? null : splitLocalePath(pathname);
  const localized = localePath?.prefixed && isLocalizablePath(localePath.path) ? localePath : null;

  let response: NextResponse;
  const networkRedirect = isAdmin ? null : platformNetworkRedirect(request.headers.get("host"), pathname);
  if (networkRedirect) {
    response = NextResponse.redirect(networkRedirect + search, 308);
  } else if (localized?.locale === "en") {
    response = NextResponse.redirect(new URL(localized.path + search, request.url), 308);
  } else if (
    isAdmin &&
    !PUBLIC_ADMIN_PATHS.some((p) => isUnder(pathname, p)) &&
    !request.cookies.get(SESSION_COOKIE)?.value
  ) {
    const login = new URL("/admin/login", request.url);
    login.searchParams.set("next", pathname + search); // login page must only accept same-origin paths
    response = NextResponse.redirect(login);
  } else {
    // Overwrite (never trust) any client-supplied x-qm-host.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-qm-host", normalizeHost(request.headers.get("host")));
    requestHeaders.delete(LOCALE_HEADER);
    if (localized) requestHeaders.set(LOCALE_HEADER, localized.locale);
    // Next takes the script nonce from the request's CSP header; never let the client supply one.
    for (const name of CSP_REQUEST_HEADERS) requestHeaders.delete(name);
    requestHeaders.delete(THEME_PREVIEW_HEADER);
    if (previewParam === "1" || previewParam === "0") requestHeaders.set(THEME_PREVIEW_HEADER, previewParam);
    if (csp && nonce && cspMode !== "off") {
      requestHeaders.set(cspHeaderName(cspMode), csp);
      requestHeaders.set("x-nonce", nonce);
    }
    // Quartermaster network on its own host (NETWORK_HOST, src/lib/network.ts): "/x" is served by /network/x.
    const networkPath = onNetworkHost ? networkRewritePath(pathname) : null;
    const rewriteTo = networkPath ?? localized?.path ?? null;
    response = rewriteTo
      ? NextResponse.rewrite(new URL(rewriteTo + search, request.url), { request: { headers: requestHeaders } })
      : NextResponse.next({ request: { headers: requestHeaders } });
  }

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  // Fair mode scans QR labels with the camera (src/app/admin/fair, docs/fair-mode.md).
  if (isUnder(pathname, "/admin/fair")) {
    response.headers.set("Permissions-Policy", SECURITY_HEADERS["Permissions-Policy"].replace("camera=()", "camera=(self)"));
  }
  if (previewParam === "1") {
    response.cookies.set(THEME_PREVIEW_COOKIE, "1", {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: THEME_PREVIEW_MAX_AGE_SECONDS,
    });
  } else if (previewParam === "0") {
    response.cookies.delete(THEME_PREVIEW_COOKIE);
  }
  // A preview may render the draft theme: never let a shared cache keep it.
  if (previewOn) {
    response.headers.set("Cache-Control", "private, no-store");
    // Draft themes must never be indexed (docs/seo-geo.md).
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  // Admin: never framed. Shop (checkout, account forms): same-origin only (clickjacking).
  response.headers.set("X-Frame-Options", isAdmin ? "DENY" : "SAMEORIGIN");
  if (csp && cspMode !== "off") {
    response.headers.set(cspHeaderName(cspMode), csp);
    response.headers.set("Reporting-Endpoints", reportingEndpointsHeader());
  }
  return response;
}

export const config = {
  // sw.js (web push service worker, docs/push.md) is a static script: no HTML nonce/CSP logic.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|fonts/|uploads/|uploads$|api/health|sw\\.js$).*)"],
};
