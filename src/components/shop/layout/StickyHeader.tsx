"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Sticky header wrapper that sets `data-scrolled` once the page scrolls past a sentinel, so the
 * header can shrink with `group-data-[scrolled]/header:` utilities. Uses IntersectionObserver
 * (no scroll listeners).
 */
export function StickyHeader({ children }: { children: ReactNode }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting), { rootMargin: "0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="absolute top-0 h-px w-px" />
      <header
        data-scrolled={scrolled || undefined}
        className="group/header sticky top-0 z-40 border-b border-shop-line bg-shop-bg text-shop-ink transition-shadow data-[scrolled]:shadow-shop"
      >
        {children}
      </header>
    </>
  );
}
