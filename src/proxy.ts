// Next 16 proxy (formerly middleware). Optimistic checks only — no DB access here.
// Real authorization happens in server code (src/server/auth/guards.ts).
import { NextResponse, type NextRequest } from "next/server";

// Keep in sync with SESSION_COOKIE in src/server/auth/session.ts (that module is server-only).
const SESSION_COOKIE = "qm_session";

/** Admin paths reachable without a session cookie (prefix match on a path segment boundary). */
const PUBLIC_ADMIN_PATHS = ["/admin/login"];

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

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isAdmin = isUnder(pathname, "/admin");

  let response: NextResponse;
  if (
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
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  if (isAdmin) response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|uploads/|uploads$|api/health).*)"],
};
