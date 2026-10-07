import "server-only";
import { actionFail, type ActionResult, type FieldErrors } from "@/components/admin/ui";
import { AuthError } from "@/server/auth/guards";
import { ServiceError } from "@/server/context";
import { provenanceCardCopy as copy } from "./_copy";

/** Maps service / guard errors to an ActionResult (unknown errors are logged, never leaked). */
export function failFrom(err: unknown): ActionResult {
  if (err instanceof AuthError) return actionFail(err.code === "UNAUTHENTICATED" ? copy.errors.unauthenticated : copy.errors.forbidden);
  if (err instanceof ServiceError) {
    if (err.code === "FORBIDDEN") return actionFail(copy.errors.forbidden);
    const d = err.details;
    let fieldErrors: FieldErrors | undefined;
    if (Array.isArray(d)) {
      fieldErrors = {};
      for (const issue of d) {
        if (issue && typeof issue.path === "string" && issue.path && typeof issue.message === "string") (fieldErrors[issue.path] ??= []).push(issue.message);
      }
      if (!Object.keys(fieldErrors).length) fieldErrors = undefined;
    } else if (d && typeof d === "object" && typeof (d as { field?: unknown }).field === "string") {
      fieldErrors = { [(d as { field: string }).field]: [err.message] };
    }
    return actionFail(err.message, fieldErrors);
  }
  console.error("[inventory/provenance]", err);
  return actionFail(copy.errors.generic);
}
