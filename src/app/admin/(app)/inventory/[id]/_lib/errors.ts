import "server-only";
import { actionFail, type ActionResult, type FieldErrors } from "@/components/admin/ui";
import { AuthError } from "@/server/auth/guards";
import { ServiceError } from "@/server/context";
import { copy } from "../_copy";

/** Strips the "path: " prefix that parseInput puts in front of zod messages. */
function cleanMessage(message: string) {
  return message.replace(/^[\w.]+: /, "");
}

/** Field errors from ServiceError details: zod issues `[{ path, message }]` or `{ field }`. */
function detailFieldErrors(err: ServiceError): FieldErrors | undefined {
  const d = err.details;
  if (Array.isArray(d)) {
    const out: Record<string, string[]> = {};
    for (const issue of d) {
      if (issue && typeof issue === "object" && typeof issue.path === "string" && issue.path && typeof issue.message === "string") {
        (out[issue.path] ??= []).push(issue.message);
      }
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (d && typeof d === "object" && typeof (d as { field?: unknown }).field === "string") {
    return { [(d as { field: string }).field]: [cleanMessage(err.message)] };
  }
  return undefined;
}

/**
 * Maps an error thrown by a service / guard to a user-facing ActionResult.
 * Unknown errors are logged and turned into a generic message (never leak internals).
 */
export function failFromError(err: unknown, fallbackField?: string): ActionResult {
  if (err instanceof AuthError) {
    return actionFail(err.code === "UNAUTHENTICATED" ? copy.errors.unauthenticated : copy.errors.forbidden);
  }
  if (err instanceof ServiceError) {
    if (err.code === "NOT_FOUND") return actionFail(cleanMessage(err.message) || copy.errors.notFound);
    if (err.code === "FORBIDDEN") return actionFail(copy.errors.forbidden);
    const message = cleanMessage(err.message);
    if (err.code === "CONFLICT") {
      if (/sku/i.test(message)) return actionFail(copy.errors.checkFields, { sku: [message] });
      if (/slug/i.test(message)) return actionFail(copy.errors.checkFields, { slug: [message] });
      return actionFail(message);
    }
    const fieldErrors = detailFieldErrors(err) ?? (fallbackField ? { [fallbackField]: [message] } : undefined);
    return actionFail(fieldErrors ? copy.errors.checkFields : message, fieldErrors);
  }
  console.error("[inventory/edit]", err);
  return actionFail(copy.errors.generic);
}

/** Message only (for toasts / JSON responses). */
export function messageFromError(err: unknown): string {
  const r = failFromError(err);
  return (!r.ok && r.message) || copy.errors.generic;
}
