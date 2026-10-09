import type { Metadata } from "next";
import { headers } from "next/headers";
import { LOCALE_HEADER, parseLocaleHeader } from "@/lib/i18n/shop-locales";
import { getDictionary } from "@/lib/i18n";
import { ZodJitless } from "@/components/ZodJitless";

const t = getDictionary();

export const metadata: Metadata = {
  title: { template: "%s · Quartermaster", default: t.app.name },
  description: t.app.description,
};

// Stylesheets are per area (performance): the admin imports src/app/globals.css in src/app/admin/layout.tsx,
// the storefront imports src/app/(shop)/shop.css (with its own Tailwind preflight). The admin sheet
// (all admin themes + utilities of the whole app) used to load render-blocking on every shop page.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Shop language from src/proxy.ts ("/de/…" → de); admin and unprefixed shop pages are English.
  const lang = parseLocaleHeader((await headers()).get(LOCALE_HEADER));
  return (
    <html lang={lang} className="h-full">
      <body className="min-h-full">
        <ZodJitless />
        {children}
      </body>
    </html>
  );
}
