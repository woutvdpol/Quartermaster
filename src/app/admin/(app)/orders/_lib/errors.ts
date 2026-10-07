import "server-only";
import { ZodError } from "zod";
import { actionFail, zodFieldErrors, type ActionResult } from "@/components/admin/ui";
import { ServiceError } from "@/server/context";
import { AuthError } from "@/server/auth/guards";

const COPY = {
  forbidden: "You don't have access to this shop. Sign in again or switch shop.",
  unauthenticated: "Your session has ended. Sign in again.",
  invalid: "Check the highlighted fields.",
  unavailable: "This isn't available right now. Try again in a moment.",
  unknown: "Something went wrong. Nothing was changed — try again.",
};

/**
 * Maps service/auth/validation errors to an ActionResult with a user-facing message.
 * ServiceError messages are written for people ("Order is already paid"), so they are shown as is.
 */
export function failFromError(error: unknown, notFound: string): ActionResult {
  if (error instanceof AuthError) {
    return actionFail(error.code === "UNAUTHENTICATED" ? COPY.unauthenticated : COPY.forbidden);
  }
  if (error instanceof ServiceError) {
    switch (error.code) {
      case "NOT_FOUND":
        return actionFail(notFound);
      case "FORBIDDEN":
        return actionFail(COPY.forbidden);
      case "UNAVAILABLE":
        return actionFail(COPY.unavailable);
      default:
        return actionFail(error.message && error.message !== error.code ? `${error.message}.` : COPY.unknown);
    }
  }
  if (error instanceof ZodError) return actionFail(COPY.invalid, zodFieldErrors(error));
  console.error(error);
  return actionFail(COPY.unknown);
}

/** Selected row ids from a bulk form, de-duplicated and bounded. */
export function idsFrom(formData: FormData, name = "ids"): string[] {
  const ids = formData.getAll(name).filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64);
  return [...new Set(ids)].slice(0, 200);
}
