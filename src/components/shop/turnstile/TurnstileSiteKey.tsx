"use client";

import { createContext, useContext, type ReactNode } from "react";

/*
 * The Turnstile site key is runtime configuration: the shop layout (a server component) reads
 * TURNSTILE_SITE_KEY from the pod's environment and provides it here, so one image works for every
 * environment. NEXT_PUBLIC_TURNSTILE_SITE_KEY (inlined at build time) stays as a fallback.
 */
const SiteKeyContext = createContext<string | undefined>(undefined);

export function TurnstileSiteKeyProvider({ siteKey, children }: { siteKey: string | undefined; children: ReactNode }) {
  return <SiteKeyContext.Provider value={siteKey}>{children}</SiteKeyContext.Provider>;
}

export function useTurnstileSiteKey(): string | undefined {
  return useContext(SiteKeyContext) || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined;
}
