import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/components/shop/ui/cn";
import { PLATFORM_FONT_CSS, PLATFORM_FONT_PRELOADS, platformFontVariables } from "@/lib/platform-fonts";
import { platformCopy as t } from "./_copy";
import { LandingNav } from "./LandingNav";
import { wordmarkClass, wrapClass } from "./parts";
import "./platform.css";

/*
 * Frame of every page on the platform host (landing, dealer sign-up and its confirmation pages; DESIGN.md):
 * self-hosted fonts, the sticky nav and the footer. The (shop) layout renders platform-host pages unwrapped.
 * `home` = the landing itself, where the nav anchors stay on the page.
 */

/** The sign-up form, wherever a "start / apply" button points (owner, 2026-10-29). */
export const APPLY_FORM_HREF = "/apply#apply-form";

export function PlatformShell({ children, cta, ctaHref = APPLY_FORM_HREF, home = false }: { children: ReactNode; cta: string; ctaHref?: string; home?: boolean }) {
  return (
    <div className={cn("qm-platform flex min-h-dvh flex-col bg-pf-paper font-pf-body text-base leading-[1.55] text-pf-ink sm:text-[17px]", platformFontVariables)}>
      {/* Self-hosted fonts (src/lib/platform-fonts.ts); React hoists these into <head>. */}
      {PLATFORM_FONT_PRELOADS.map((href) => (
        <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
      ))}
      <style href="qm-platform-fonts" precedence="default">
        {PLATFORM_FONT_CSS}
      </style>

      <LandingNav name={t.name} cta={cta} ctaHref={ctaHref} base={home ? "" : "/"} t={t.nav} />

      {/* Grows, so the footer sits at the bottom of short pages (thanks, verify). */}
      <main id="top" className="flex flex-1 flex-col">
        {children}
      </main>

      <footer className="border-t border-pf-line bg-pf-paper-2">
        <div className={cn(wrapClass, "flex flex-wrap items-center justify-between gap-x-8 gap-y-4 py-8 text-[14.5px] text-pf-muted")}>
          <span>
            <a href={home ? "#top" : "/"} className={cn(wordmarkClass, "mr-3 text-pf-ink")}>
              {t.name}
            </a>
            {t.tagline}
          </span>
          <nav aria-label={t.footer.label} className="flex flex-wrap gap-6">
            <Link href={APPLY_FORM_HREF} className="no-underline hover:text-pf-ink">
              {t.footer.open}
            </Link>
            <Link href="/network" className="no-underline hover:text-pf-ink">
              {t.footer.network}
            </Link>
            <Link href="/admin" className="no-underline hover:text-pf-ink">
              {t.footer.login}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** The single card of the confirmation pages (thanks, verify), on a quiet band. */
export function PlatformCard({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  return (
    <div className="flex-1 bg-pf-paper-2 py-[clamp(48px,8vw,112px)]">
      <div className={wrapClass}>
        <section aria-labelledby={labelledBy} className="mx-auto max-w-[560px] rounded-[14px] border border-pf-line bg-pf-paper p-6 sm:p-9">
          {children}
        </section>
      </div>
    </div>
  );
}
