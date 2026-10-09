/**
 * Return-URL handling for the shop's login/register flows. Pure (no `server-only`) so it can be unit
 * tested and used by client components that build login links.
 *
 * Only same-origin storefront paths are accepted: they must start with a single "/", contain no
 * backslashes or control characters, and never point into /admin or /api (a customer session has no
 * business there and it would turn the login into an open-redirect helper).
 */

import { splitLocalePath } from "@/lib/i18n/shop-locales";

export const DEFAULT_AFTER_LOGIN = "/account";

const MAX_LENGTH = 512;

export function safeShopRedirect(input: unknown, fallback: string = DEFAULT_AFTER_LOGIN): string {
  if (typeof input !== "string") return fallback;
  const url = input.trim();
  if (!url || url.length > MAX_LENGTH) return fallback;
  if (!url.startsWith("/") || url.startsWith("//")) return fallback;
  if (url.includes("\\") || /[\u0000-\u001F\u007F\s]/.test(url)) return fallback;
  // Checked without the language prefix ("/de/login" is an auth page too).
  const path = splitLocalePath(url.split(/[?#]/)[0]).path.toLowerCase();
  if (/^\/(admin|api)(\/|$)/.test(path)) return fallback;
  // Auth pages themselves are not useful destinations (avoid login → login loops).
  if (/^\/(login|register|forgot-password)(\/|$)/.test(path) || path === "/account/reset-password") return fallback;
  return url;
}

/** `/login?next=…` link for a guest that tries a members-only action on `returnTo`. */
export function loginHref(returnTo?: string | null): string {
  const next = safeShopRedirect(returnTo, "");
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}
