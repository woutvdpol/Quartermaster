import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ADMIN_FONT_CSS, ADMIN_FONT_PRELOAD, adminFontVariables } from "@/lib/admin-fonts";
import { ADMIN_THEME_COOKIE, adminThemeAttributes, parseAdminThemeCookie } from "@/lib/admin-theme";
// Admin-only stylesheet (not in the root layout, so the storefront does not download it).
import "../globals.css";

export const metadata: Metadata = {
  title: { template: "%s · Quartermaster admin", default: "Quartermaster admin" },
  robots: { index: false, follow: false },
};

/*
 * Admin root: NOT auth-gated (the login pages render inside it). The authenticated shell lives in
 * the (app) route group. The theme comes from the `qm_admin_theme` cookie so SSR already renders
 * the selected design and colour mode — no flash of the wrong theme.
 */
export default async function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  const pref = parseAdminThemeCookie((await cookies()).get(ADMIN_THEME_COOKIE)?.value);
  return (
    <div {...adminThemeAttributes(pref)} className={`${adminFontVariables} min-h-dvh`}>
      {/* Self-hosted fonts (src/lib/admin-fonts.ts); React hoists both into <head>. */}
      <link rel="preload" href={ADMIN_FONT_PRELOAD} as="font" type="font/woff2" crossOrigin="anonymous" />
      <style href="qm-admin-fonts" precedence="default">
        {ADMIN_FONT_CSS}
      </style>
      {children}
    </div>
  );
}
