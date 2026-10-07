"use client";

import { useEffect, useRef } from "react";

/*
 * Cloudflare Turnstile widget (explicit rendering).
 *
 *   <form action={…}>
 *     …fields…
 *     <Turnstile action="sell" onToken={setToken} resetKey={state} />
 *   </form>
 *
 * The widget adds a hidden `cf-turnstile-response` input to the surrounding form, so plain form
 * actions receive the token automatically; read it server-side with `turnstileTokenFrom(formData)`
 * and check it with `verifyTurnstile(token, ip)` (src/server/turnstile).
 *
 * Renders nothing when no site key is configured (NEXT_PUBLIC_TURNSTILE_SITE_KEY unset): the server
 * then allows submissions in development and denies them in production.
 * Tokens are single use: change `resetKey` (e.g. pass the action state) after every submit so the
 * widget issues a fresh token.
 */

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile failed to initialise")));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Turnstile script failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export type TurnstileProps = {
  /** Defaults to NEXT_PUBLIC_TURNSTILE_SITE_KEY. */
  siteKey?: string;
  /** Called with a fresh token, or null when it expired / errored. */
  onToken?: (token: string | null) => void;
  /** Widget action (analytics in the CF dashboard; verified server-side when passed to verifyTurnstile). */
  action?: string;
  /** Change this value to reset the widget (tokens are single use). */
  resetKey?: unknown;
  theme?: "auto" | "light" | "dark";
  className?: string;
};

export function Turnstile({ siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, onToken, action, resetKey, theme = "auto", className }: TurnstileProps) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let cancelled = false;
    const el = ref.current;
    loadTurnstile()
      .then((api) => {
        if (cancelled) return;
        widgetId.current = api.render(el, {
          sitekey: siteKey,
          action,
          theme,
          "response-field-name": "cf-turnstile-response",
          callback: (token: string) => onTokenRef.current?.(token),
          "expired-callback": () => onTokenRef.current?.(null),
          "error-callback": () => onTokenRef.current?.(null),
        });
      })
      .catch((error: Error) => console.warn("[turnstile]", error.message));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action, theme]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current);
      onTokenRef.current?.(null);
    }
  }, [resetKey]);

  if (!siteKey) return null;
  return <div ref={ref} className={className} />;
}
