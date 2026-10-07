import "server-only";

/**
 * Cloudflare Turnstile server-side verification (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
 *
 * Configuration: TURNSTILE_SECRET_KEY (server) + NEXT_PUBLIC_TURNSTILE_SITE_KEY (widget).
 *  - Secret missing in development/test → requests are ALLOWED (so local forms work without keys).
 *  - Secret missing in production → requests are DENIED and an error is logged: a public form must
 *    never silently run without bot protection.
 *  - Network/timeout errors fail closed (deny) — the visitor can retry.
 *
 * Tokens are single use and valid for 5 minutes; verify once, on the final submit.
 */

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Name of the hidden input the widget adds to the surrounding form. */
export const TURNSTILE_FIELD = "cf-turnstile-response";

const MAX_TOKEN_LENGTH = 2048;
const TIMEOUT_MS = 5000;

export type TurnstileResult =
  | { ok: true; reason: "verified" | "not-configured" }
  | { ok: false; reason: "missing-token" | "not-configured" | "rejected" | "action-mismatch" | "unavailable"; errorCodes?: string[] };

export type VerifyTurnstileOptions = {
  /** Expected widget `action` (when the widget sets one). */
  action?: string;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  /** Override env (tests). */
  secret?: string | null;
  nodeEnv?: string;
};

let warnedDevBypass = false;

export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
}

export async function verifyTurnstile(
  token: string | null | undefined,
  ip: string | null | undefined,
  opts: VerifyTurnstileOptions = {},
): Promise<TurnstileResult> {
  const secret = (opts.secret !== undefined ? opts.secret : process.env.TURNSTILE_SECRET_KEY)?.trim() || null;
  const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV;

  if (!secret) {
    if (nodeEnv === "production") {
      console.error("[turnstile] TURNSTILE_SECRET_KEY is not set — protected form submission DENIED. Configure Turnstile keys.");
      return { ok: false, reason: "not-configured" };
    }
    if (!warnedDevBypass) {
      warnedDevBypass = true;
      console.warn("[turnstile] TURNSTILE_SECRET_KEY is not set — allowing submissions (development only).");
    }
    return { ok: true, reason: "not-configured" };
  }

  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "missing-token" };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);

  let data: { success?: boolean; action?: string; "error-codes"?: string[] };
  try {
    const res = await (opts.fetchImpl ?? fetch)(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[turnstile] siteverify responded ${res.status}`);
      return { ok: false, reason: "unavailable" };
    }
    data = (await res.json()) as typeof data;
  } catch (error) {
    console.error("[turnstile] siteverify request failed:", (error as Error).message);
    return { ok: false, reason: "unavailable" };
  }

  if (data.success !== true) return { ok: false, reason: "rejected", errorCodes: data["error-codes"] ?? [] };
  if (opts.action && data.action && data.action !== opts.action) return { ok: false, reason: "action-mismatch" };
  return { ok: true, reason: "verified" };
}

/** Reads the widget's token from a submitted form. */
export function turnstileTokenFrom(formData: FormData): string | null {
  const v = formData.get(TURNSTILE_FIELD);
  return typeof v === "string" && v ? v : null;
}
