import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { shopFontFaceCss, shopFontFamily } from "@/components/shop/layout/fonts";
import { networkHref } from "@/lib/network";
import { networkCopy as t } from "../_copy";

/*
 * Chrome of the Quartermaster network pages (docs/design/fair-archive-push-network/Network.dc.html):
 * dark top bar, page content, the "For dealers" band. Fixed Quartermaster styling — no shop tokens; the
 * (shop) layout renders these pages unwrapped on the platform host and on NETWORK_HOST.
 */

const FACES = ["IBM Plex Sans", "IBM Plex Mono", "Big Shoulders"] as const;

const fontVars = {
  "--nw-sans": shopFontFamily("IBM Plex Sans"),
  "--nw-display": shopFontFamily("Big Shoulders"),
  "--nw-mono": `"QM IBM Plex Mono", ui-monospace, monospace`,
} as CSSProperties;

export function NetworkShell({ base, applyUrl, children }: { base: string; applyUrl: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#F4F3EC] text-[#1E2119] [font-family:var(--nw-sans)]" style={fontVars}>
      <style href="qm-network-fonts" precedence="default">
        {shopFontFaceCss(FACES)}
      </style>
      <header className="bg-[#2A2F22] text-[#ECECE5]">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-6">
          <Link href={networkHref(base)} className="text-[26px] font-extrabold tracking-[0.06em] text-[#ECECE5] uppercase [font-family:var(--nw-display)]">
            {t.brand}{" "}
            <span className="align-middle text-[13px] font-normal tracking-[0.16em] text-[#D9A94E] [font-family:var(--nw-mono)]">{t.brandTag}</span>
          </Link>
          <nav aria-label={t.navLabel} className="flex gap-5 text-sm">
            <Link href={networkHref(base)} className="text-[#D9DCCB] hover:text-white">
              {t.nav.search}
            </Link>
            <Link href={networkHref(base, "/dealers")} className="text-[#D9DCCB] hover:text-white">
              {t.nav.dealers}
            </Link>
            <a href="#for-dealers" className="text-[#D9DCCB] hover:text-white">
              {t.nav.forDealers}
            </a>
          </nav>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <section id="for-dealers" className="bg-[#E4E2D6]" aria-labelledby="for-dealers-title">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-5 px-4 py-8 sm:px-6">
          <div className="max-w-[680px]">
            <h2 id="for-dealers-title" className="text-[28px] leading-tight font-bold [font-family:var(--nw-display)]">
              {t.band.title}
            </h2>
            <p className="mt-1.5 text-[#4A4D40]">{t.band.body}</p>
          </div>
          <a href={applyUrl} className="inline-flex h-12 items-center rounded-full bg-[#1E2119] px-5.5 font-semibold text-white hover:bg-[#7E5416]">
            {t.band.cta}
          </a>
        </div>
      </section>
    </div>
  );
}
