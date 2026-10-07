/*
 * Admin theme preference: which design ("depot" = A, "ledger" = B, "naval" = C) and which colour mode.
 * Safe to import from both server and client code (no server-only APIs here).
 *
 * The preference is stored in the `qm_admin_theme` cookie as "<theme>.<mode>", e.g. "depot.system",
 * so the admin layout can render the right `data-admin-theme` / `data-theme` attributes during SSR
 * (no flash of the wrong theme). The token values live in src/app/globals.css.
 */

export const ADMIN_THEMES = ["depot", "ledger", "naval"] as const;
export type AdminTheme = (typeof ADMIN_THEMES)[number];

export const COLOR_MODES = ["system", "light", "dark"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export type AdminThemePreference = { theme: AdminTheme; mode: ColorMode };

export const ADMIN_THEME_COOKIE = "qm_admin_theme";
export const ADMIN_THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Design A "Depot" is the owner's chosen default. */
export const DEFAULT_ADMIN_THEME: AdminThemePreference = { theme: "depot", mode: "system" };

export function isAdminTheme(value: unknown): value is AdminTheme {
  return typeof value === "string" && (ADMIN_THEMES as readonly string[]).includes(value);
}

export function isColorMode(value: unknown): value is ColorMode {
  return typeof value === "string" && (COLOR_MODES as readonly string[]).includes(value);
}

/** Parses the cookie value; anything unknown falls back to the default for that part. */
export function parseAdminThemeCookie(value: string | null | undefined): AdminThemePreference {
  if (!value) return DEFAULT_ADMIN_THEME;
  const [theme, mode] = value.split(".");
  return {
    theme: isAdminTheme(theme) ? theme : DEFAULT_ADMIN_THEME.theme,
    mode: isColorMode(mode) ? mode : DEFAULT_ADMIN_THEME.mode,
  };
}

export function serializeAdminThemeCookie(pref: AdminThemePreference): string {
  return `${pref.theme}.${pref.mode}`;
}

/** Attributes for the admin root element. `data-theme` is omitted in "system" mode (CSS follows the OS). */
export function adminThemeAttributes(pref: AdminThemePreference): {
  "data-admin-theme": AdminTheme;
  "data-theme"?: "light" | "dark";
} {
  return pref.mode === "system"
    ? { "data-admin-theme": pref.theme }
    : { "data-admin-theme": pref.theme, "data-theme": pref.mode };
}
