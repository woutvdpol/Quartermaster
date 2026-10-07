"use client";

import { z } from "zod";

// zod v4 probes for JIT support with `new Function("")` the first time a schema parses. Under the
// Content-Security-Policy (no 'unsafe-eval') that probe is blocked and reported on every page that
// parses in the browser (checkout). It falls back fine, but the reports are noise — so the browser
// bundle opts out of JIT up front. Server-side parsing is unaffected (this module only runs client-side).
z.config({ jitless: true });

/** Renders nothing; mounted once in the root layout so the config above runs in every client bundle. */
export function ZodJitless() {
  return null;
}
