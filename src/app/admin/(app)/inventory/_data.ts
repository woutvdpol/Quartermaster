import "server-only";
import { unstable_rethrow } from "next/navigation";
import { AuthError } from "@/server/auth/guards";
import { ServiceError } from "@/server/context";
import type { CategoryNode } from "@/server/catalog/categories";
import { actionFail, type ActionResult } from "@/components/admin/ui";

/* Small route-local reads/helpers for the inventory and categories screens. */

export type FlatCategory = { id: string; title: string; path: string; depth: number; parentId: string | null; isActive: boolean };

/** Depth-first list of the tree with " › "-joined paths (for selects and the category column). */
export function flattenCategories(nodes: CategoryNode[], depth = 0, prefix: string[] = []): FlatCategory[] {
  return nodes.flatMap((n) => [
    { id: n.id, title: n.title, path: [...prefix, n.title].join(" › "), depth, parentId: n.parentId, isActive: n.isActive },
    ...flattenCategories(n.children, depth + 1, [...prefix, n.title]),
  ]);
}

type FailureDetail = { stockCode?: number; reason?: string };

function isFailureList(details: unknown): details is FailureDetail[] {
  return Array.isArray(details) && details.every((d) => d && typeof d === "object" && "stockCode" in d && "reason" in d);
}

/**
 * Maps service/auth errors to a user-facing ActionResult. All-or-nothing bulk failures
 * (ServiceError INVALID with [{ stockCode, reason }]) are listed per stock code.
 */
export function errorResult(err: unknown, fallback: string): ActionResult {
  unstable_rethrow(err);
  if (err instanceof AuthError) {
    return actionFail(err.code === "UNAUTHENTICATED" ? "Your session has expired. Sign in again." : "You do not have access to this shop.");
  }
  if (err instanceof ServiceError) {
    if (isFailureList(err.details) && err.details.length > 0) {
      const shown = err.details.slice(0, 8).map((d) => `#${d.stockCode} (${d.reason})`);
      const more = err.details.length > shown.length ? `, and ${err.details.length - shown.length} more` : "";
      return actionFail(`Nothing was changed. ${err.details.length === 1 ? "This product is" : "These products are"} blocking: ${shown.join(", ")}${more}.`);
    }
    switch (err.code) {
      case "NOT_FOUND":
        return actionFail(`${err.message}. It may have been removed; reload the page.`);
      case "FORBIDDEN":
        return actionFail("You do not have permission to do this.");
      case "UNAVAILABLE":
        return actionFail("This is temporarily unavailable. Try again shortly.");
      default:
        return actionFail(err.message || fallback);
    }
  }
  console.error(err);
  return actionFail(fallback);
}
