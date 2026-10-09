"use client";

import Link from "next/link";
import { localizePath } from "@/lib/i18n/shop-locales";
import { useShopLocale } from "@/components/shop/i18n/ShopLocale";
import { useRouter } from "next/navigation";
import { useRef, type ComponentProps } from "react";

type AppRouter = ReturnType<typeof useRouter>;
/** `PrefetchKind.FULL` — the enum lives in a Next internal module, its value is the public string "full". */
const FULL = { kind: "full" } as unknown as NonNullable<Parameters<AppRouter["prefetch"]>[1]>;
/** Pointer dwell before prefetching, so sweeping the cursor across a grid does not prefetch every card. */
const HOVER_DELAY_MS = 60;

/**
 * `<Link>` that prefetches the WHOLE target page once the visitor shows intent (hover ≥ 60 ms, touch
 * start or keyboard focus), so the click navigates without waiting for the server (docs/perf/round2.md
 * § Navigatie). Shop pages are dynamic, so the default viewport prefetch only fetches the route tree.
 * The prefetched page is reused for at most `staleTimes.static` (30 s, next.config.ts); live state
 * (cart, reservations) is re-checked by the server actions anyway.
 */
export function IntentLink({ href: rawHref, onPointerEnter, onPointerLeave, onTouchStart, onFocus, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const router = useRouter();
  // Keeps the visitor's language ("/product/1/x" → "/de/product/1/x"), like ./Link.tsx.
  const href = localizePath(rawHref, useShopLocale());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Repeated calls are cheap: the router skips URLs whose prefetch is still fresh in its cache.
  const warm = () => router.prefetch(href, FULL);
  return (
    <Link
      href={href}
      onPointerEnter={(e) => {
        onPointerEnter?.(e);
        if (e.pointerType === "mouse") timer.current = setTimeout(warm, HOVER_DELAY_MS);
      }}
      onPointerLeave={(e) => {
        onPointerLeave?.(e);
        if (timer.current) clearTimeout(timer.current);
      }}
      onTouchStart={(e) => {
        onTouchStart?.(e);
        warm();
      }}
      onFocus={(e) => {
        onFocus?.(e);
        warm();
      }}
      {...props}
    />
  );
}
