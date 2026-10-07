import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import {
  actionFail,
  zodFieldErrors,
  type ActionResult,
} from "@/components/admin/ui";
import { AuthError } from "@/server/auth/guards";
import { ServiceError } from "@/server/context";

/*
 * Error mapping for the newsletter actions. The newsletter services throw ServiceErrors whose
 * messages are written for users ("There are no active subscribers", "Monthly newsletter quota
 * exceeded"), so those are shown as they are; everything else becomes a generic message.
 */

const GENERIC = "Something went wrong. Please try again.";

const CODE_MESSAGES: Record<ServiceError["code"], string> = {
  NOT_FOUND: "This item no longer exists. Reload the page.",
  CONFLICT: "This conflicts with the current state. Reload the page.",
  INVALID: "Check the highlighted fields.",
  FORBIDDEN: "You are not allowed to do this.",
  UNAVAILABLE: "The newsletter is not enabled for this shop.",
};

function quotaMessage(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const d = details as { remaining?: unknown; needed?: unknown };
  if (typeof d.remaining === "number") {
    return `Monthly newsletter quota exceeded: ${d.remaining} mails left this month${typeof d.needed === "number" ? `, ${d.needed} needed` : ""}.`;
  }
  return null;
}

export function failFrom(err: unknown): ActionResult {
  unstable_rethrow(err);
  if (err instanceof AuthError) {
    return actionFail(
      err.code === "UNAUTHENTICATED"
        ? "Your session has expired. Sign in again."
        : CODE_MESSAGES.FORBIDDEN,
    );
  }
  if (err instanceof ZodError)
    return actionFail(CODE_MESSAGES.INVALID, zodFieldErrors(err));
  if (err instanceof ServiceError) {
    if (err.code === "CONFLICT" && /quota/i.test(err.message))
      return actionFail(quotaMessage(err.details) ?? err.message);
    return actionFail(
      err.message && err.message !== err.code
        ? err.message
        : CODE_MESSAGES[err.code],
    );
  }
  console.error("[admin/newsletter] action failed:", err);
  return actionFail(GENERIC);
}
