import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { zodFieldErrors, type ActionResult, type FieldErrors } from "@/components/admin/ui";
import { AuthError } from "@/server/auth/guards";
import { ServiceError } from "@/server/context";

/*
 * Shared error mapping for the system screens' server actions (settings, shipping, payments, users,
 * account, audit log, platform). Services throw ServiceError / AuthError / ZodError; this turns them
 * into an ActionResult the kit forms and ConfirmDialog understand.
 */

/** A failed ActionResult; assignable to ActionResult<F, D> for any data type D. */
export type Failure = Extract<ActionResult, { ok: false }>;

/** Like the kit's actionFail, typed as a Failure so it fits actions that return data on success. */
export function fail(message?: string, fieldErrors?: FieldErrors): Failure {
  return { ok: false, message, fieldErrors };
}

const GENERIC = "Something went wrong. Please try again.";

const CODE_MESSAGES: Record<ServiceError["code"], string> = {
  NOT_FOUND: "This item no longer exists. Reload the page.",
  CONFLICT: "This conflicts with existing data.",
  INVALID: "Check the highlighted fields.",
  FORBIDDEN: "You are not allowed to do this.",
  UNAVAILABLE: "The service is not reachable right now. Try again later.",
};

/** ServiceError("INVALID") from `parseInput` carries `[{ path, message }]` issues as details. */
function detailFieldErrors(details: unknown, prefix?: string): FieldErrors | undefined {
  if (!Array.isArray(details)) return undefined;
  const out: Record<string, string[]> = {};
  for (const d of details) {
    if (!d || typeof d !== "object") continue;
    const { path, message } = d as { path?: unknown; message?: unknown };
    if (typeof message !== "string") continue;
    const key = [prefix, typeof path === "string" && path ? path : undefined].filter(Boolean).join(".") || "_form";
    (out[key] ??= []).push(message);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Strips the "path: " prefix `parseInput` puts in front of the first issue. */
function cleanMessage(message: string, code: ServiceError["code"]): string {
  if (!message || message === code) return CODE_MESSAGES[code];
  return message;
}

/**
 * Converts a thrown error into a failed ActionResult. Next.js control-flow errors (redirect,
 * notFound) are re-thrown. `fieldPrefix` prefixes field-error keys (e.g. "rates").
 */
export function failFrom(err: unknown, opts: { fieldPrefix?: string; fallback?: string } = {}): Failure {
  unstable_rethrow(err);
  if (err instanceof AuthError) {
    return fail(err.code === "UNAUTHENTICATED" ? "Your session has expired. Sign in again." : CODE_MESSAGES.FORBIDDEN);
  }
  if (err instanceof ZodError) {
    const fe = zodFieldErrors(err);
    const prefixed = opts.fieldPrefix
      ? Object.fromEntries(Object.entries(fe).map(([k, v]) => [`${opts.fieldPrefix}.${k}`, v]))
      : fe;
    return fail(CODE_MESSAGES.INVALID, prefixed);
  }
  if (err instanceof ServiceError) {
    const fieldErrors = err.code === "INVALID" ? detailFieldErrors(err.details, opts.fieldPrefix) : undefined;
    let message = cleanMessage(err.message, err.code);
    const firstPath = Array.isArray(err.details) ? (err.details[0] as { path?: unknown } | undefined)?.path : undefined;
    if (typeof firstPath === "string" && firstPath && message.startsWith(`${firstPath}: `)) message = message.slice(firstPath.length + 2);
    // "countries: A delivery zone needs…" style messages without details
    if (!fieldErrors && err.code === "INVALID") {
      const m = /^([a-zA-Z][\w.]*): (.+)$/.exec(message);
      if (m) return fail(m[2], { [[opts.fieldPrefix, m[1]].filter(Boolean).join(".")]: [m[2]] });
    }
    return fail(message, fieldErrors);
  }
  console.error("[admin/system] action failed:", err);
  return fail(opts.fallback ?? GENERIC);
}

/** Message for a page-level load failure (e.g. Mollie unreachable while listing methods). */
export function loadErrorMessage(err: unknown): string {
  unstable_rethrow(err);
  if (err instanceof ServiceError) return cleanMessage(err.message, err.code);
  if (err instanceof AuthError) return CODE_MESSAGES.FORBIDDEN;
  console.error("[admin/system] load failed:", err);
  return GENERIC;
}
