/*
 * Theme preview mode (Website → Theme). Plain constants shared by src/proxy.ts (no server-only
 * imports there) and the storefront.
 *
 *  - `/any-shop-path?qm-theme-preview=1` turns preview on: the proxy sets the cookie below and
 *    forwards THEME_PREVIEW_HEADER=1 for that same request; `=0` turns it off again.
 *  - The cookie is only a request for preview. The shop renders the draft only for a signed-in staff
 *    member (OWNER of this tenant or SUPERADMIN) — see src/server/theme/preview.ts — so a guest who
 *    sets it sees the live shop.
 *  - Preview responses are `Cache-Control: private, no-store`; draft data never enters the shared
 *    shop cache (it is read outside shopCache).
 */
export const THEME_PREVIEW_PARAM = "qm-theme-preview";
export const THEME_PREVIEW_COOKIE = "qm_theme_preview";
/** Request header set by the proxy only ("1" on / "0" off); client-supplied values are stripped. */
export const THEME_PREVIEW_HEADER = "x-qm-theme-preview";
export const THEME_PREVIEW_MAX_AGE_SECONDS = 2 * 60 * 60;
/** postMessage type the builder sends to the preview iframe with the current (unsaved) theme. */
export const THEME_PREVIEW_MESSAGE = "qm:theme-preview";
