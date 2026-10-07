import "server-only";
import { ZodError } from "zod";
import { actionFail, type ActionResult } from "@/components/admin/ui";
import { ServiceError } from "@/server/context";
import { AuthError } from "@/server/auth/guards";

/** Maps service/auth/validation errors to a friendly ActionResult. Unknown errors are logged. */
export function failFrom(e: unknown, messages: Partial<Record<ServiceError["code"], string>> = {}): ActionResult {
  if (e instanceof AuthError) return actionFail("You don't have access to this shop. Sign in again or switch shop.");
  if (e instanceof ZodError) return actionFail("Some values are not valid. Check the form and try again.");
  if (e instanceof ServiceError) {
    const fallback: Record<ServiceError["code"], string> = {
      NOT_FOUND: "This item no longer exists. Reload the page.",
      CONFLICT: "This conflicts with existing data.",
      INVALID: e.message || "Some values are not valid.",
      FORBIDDEN: "You are not allowed to do this.",
      UNAVAILABLE: "This is temporarily unavailable. Try again in a moment.",
    };
    return actionFail(messages[e.code] ?? fallback[e.code]);
  }
  console.error("[sourcing] action failed", e);
  return actionFail("Something went wrong. Try again.");
}
