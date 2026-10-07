"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Cookieless page-view beacon for analytics provider "own" (POST /api/collect, see
 * src/app/api/collect/route.ts). Fires on first load and on every client-side route change.
 * The document referrer is only sent with the first view of the visit. Wrap in <Suspense>
 * (useSearchParams).
 */
// Dedupe (React StrictMode re-runs effects in dev; also guards against double renders).
let last = { path: "", at: 0 };

export function AnalyticsBeacon() {
  const pathname = usePathname();
  const search = useSearchParams();
  const first = useRef(true);
  const query = search.toString();

  useEffect(() => {
    const path = query ? `${pathname}?${query}` : pathname;
    const now = Date.now();
    if (last.path === path && now - last.at < 2000) return;
    last = { path, at: now };
    const body = JSON.stringify({ path, referrer: first.current ? document.referrer : "" });
    first.current = false;
    try {
      if (!navigator.sendBeacon?.("/api/collect", body)) {
        void fetch("/api/collect", { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => {});
      }
    } catch {
      // Analytics must never break the shop.
    }
  }, [pathname, query]);

  return null;
}
