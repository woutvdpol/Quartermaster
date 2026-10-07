import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { actionFail, zodFieldErrors, type ActionResult, type FieldErrors } from "@/components/admin/ui";
import { AuthError } from "@/server/auth/guards";
import { ServiceError } from "@/server/context";

/*
 * Error mapping for the content screens' server actions (pages + menus). Services throw
 * ServiceError / AuthError / ZodError; this turns them into an ActionResult for kit forms and
 * ConfirmDialog. Service messages for CONFLICT / INVALID are written for users ("The header menu
 * can have at most 7 items"), so they are shown as they are.
 */

const GENERIC = "Something went wrong. Please try again.";

const CODE_MESSAGES: Record<ServiceError["code"], string> = {
  NOT_FOUND: "This item no longer exists. Reload the page.",
  CONFLICT: "This conflicts with existing data.",
  INVALID: "Check the highlighted fields.",
  FORBIDDEN: "You are not allowed to do this.",
  UNAVAILABLE: "This is temporarily unavailable. Try again in a moment.",
};

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

/** "slug: Too long" → "Too long" (parseInput prefixes the first issue with its path). */
function cleanMessage(message: string, code: ServiceError["code"]): string {
  if (!message || message === code) return CODE_MESSAGES[code];
  return message.replace(/^[A-Za-z0-9_.]+: /, "");
}

/** Converts a thrown error into a failed ActionResult. Next.js control-flow errors are re-thrown. */
export function failFrom(err: unknown, opts: { fieldPrefix?: string; fallback?: string } = {}): ActionResult {
  unstable_rethrow(err);
  if (err instanceof AuthError) {
    return actionFail(err.code === "UNAUTHENTICATED" ? "Your session has expired. Sign in again." : CODE_MESSAGES.FORBIDDEN);
  }
  if (err instanceof ZodError) return actionFail(CODE_MESSAGES.INVALID, zodFieldErrors(err));
  if (err instanceof ServiceError) {
    const fieldErrors = err.code === "INVALID" ? detailFieldErrors(err.details, opts.fieldPrefix) : undefined;
    return actionFail(cleanMessage(err.message, err.code), fieldErrors);
  }
  console.error("[admin/content] action failed:", err);
  return actionFail(opts.fallback ?? GENERIC);
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ServiceError && err.code === "NOT_FOUND";
}
