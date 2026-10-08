"use client";

import { enableZodJitless } from "@/lib/zod-jitless";

// zod v4 probes for JIT support with `new Function("")` the first time a schema parses. Under the
// Content-Security-Policy (no 'unsafe-eval') that probe is blocked and reported on every page that
// parses in the browser (checkout). It falls back fine, but the reports are noise — so the browser
// bundle opts out of JIT up front. Server-side parsing is unaffected (this module only runs client-side).
// Performance: deliberately does NOT import "zod" — this component is in the root layout, and importing
// zod here put ~31 kB (gzip) of zod into every page's JS, also on pages that never parse anything.
enableZodJitless();

/** Renders nothing; mounted once in the root layout so the config above runs in every client bundle. */
export function ZodJitless() {
  return null;
}
