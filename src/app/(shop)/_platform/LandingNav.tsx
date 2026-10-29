"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/shop/ui/cn";
import { CloseIcon, MenuIcon } from "@/components/shop/layout/icons";
import type { platformCopy } from "./_copy";
import { buttonClass, wordmarkClass, wrapClass } from "./parts";

/* Sticky top bar of the platform landing: anchors, dealer login, the sign-up CTA and (below lg) a menu. */

type NavCopy = (typeof platformCopy)["nav"];

/** Only the nav texts come in as props, so the rest of the page copy stays out of the client bundle. */
/** `base` prefixes the section anchors: "" on the landing, "/" elsewhere (they point at the landing). */
export function LandingNav({ name, cta, ctaHref, base, t }: { name: string; cta: string; ctaHref: string; base: "" | "/"; t: NavCopy }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sections = [
    [`${base}#how`, t.how],
    [`${base}#features`, t.features],
    [`${base}#pricing`, t.pricing],
    [`${base}#network`, t.network],
  ] as const;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // The focused link may be inside the menu that is about to hide: keep the keyboard user's place.
      menuButton.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className={cn("sticky top-0 z-10 border-b bg-pf-paper/92 backdrop-blur-[10px] backdrop-saturate-[1.4] transition-colors duration-200", scrolled || open ? "border-pf-line-soft" : "border-transparent")}>
      <div className={cn(wrapClass, "flex h-[68px] items-center gap-3 lg:gap-8")}>
        <a href={base ? "/" : "#top"} className={wordmarkClass}>
          {name}
        </a>
        <nav aria-label={t.label} className="mr-auto hidden gap-7 text-[15px] font-medium lg:flex">
          {sections.map(([href, label]) => (
            <a key={href} href={href} className="text-pf-ink-2 no-underline hover:text-pf-ink">
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-[15px] font-medium lg:ml-0 lg:gap-5">
          <Link href="/admin" className="hidden text-pf-ink-2 no-underline hover:text-pf-ink sm:inline">
            {t.login}
          </Link>
          <Link href={ctaHref} className={buttonClass.primarySm}>
            {cta}
          </Link>
          <button
            ref={menuButton}
            type="button"
            aria-expanded={open}
            aria-controls="platform-menu"
            aria-label={t.menu}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex size-10 items-center justify-center rounded-lg border border-pf-line bg-pf-paper text-pf-ink hover:border-pf-ink lg:hidden"
          >
            {open ? <CloseIcon className="size-5" /> : <MenuIcon className="size-5" />}
          </button>
        </div>
      </div>
      <nav id="platform-menu" aria-label={t.label} hidden={!open} onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)} className={cn(wrapClass, "border-t border-pf-line-soft pt-2 pb-4 lg:hidden")}>
        {sections.map(([href, label]) => (
          <a key={href} href={href} className="block border-b border-pf-line-soft py-3 text-[17px] font-medium no-underline">
            {label}
          </a>
        ))}
        <Link href="/admin" className="block py-3 text-[17px] font-medium no-underline">
          {t.login}
        </Link>
      </nav>
    </header>
  );
}
