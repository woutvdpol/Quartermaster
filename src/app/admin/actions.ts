"use server";

import { cookies } from "next/headers";
import {
  ADMIN_THEME_COOKIE,
  ADMIN_THEME_COOKIE_MAX_AGE,
  isAdminTheme,
  isColorMode,
  parseAdminThemeCookie,
  serializeAdminThemeCookie,
} from "@/lib/admin-theme";

/**
 * Stores the admin theme preference. Purely cosmetic, so no auth check; values are validated
 * against the known themes/modes. Setting the cookie re-renders the admin layout with the new theme.
 */
export async function setAdminThemeAction(formData: FormData): Promise<void> {
  const store = await cookies();
  const current = parseAdminThemeCookie(store.get(ADMIN_THEME_COOKIE)?.value);
  const theme = formData.get("theme");
  const mode = formData.get("mode");
  const next = {
    theme: isAdminTheme(theme) ? theme : current.theme,
    mode: isColorMode(mode) ? mode : current.mode,
  };
  store.set(ADMIN_THEME_COOKIE, serializeAdminThemeCookie(next), {
    path: "/admin",
    maxAge: ADMIN_THEME_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}
