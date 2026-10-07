"use server";

import { AuthError } from "@/server/auth/guards";
import { requireStaffContext } from "@/server/context";
import { searchCommands } from "./search";
import type { CommandGroup } from "./types";

export type CommandSearchResult = { ok: true; groups: CommandGroup[] } | { ok: false; message: string };

/** ⌘K search. Tenant-scoped through requireStaffContext (OWNER → own shop, SUPERADMIN → chosen shop). */
export async function searchCommandsAction(query: string): Promise<CommandSearchResult> {
  if (typeof query !== "string") return { ok: false, message: "Invalid search." };
  try {
    const ctx = await requireStaffContext();
    return { ok: true, groups: await searchCommands(ctx, query.slice(0, 120)) };
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, message: "Your session has ended or you can't access this shop. Sign in again." };
    }
    console.error("[command] search failed", error);
    return { ok: false, message: "Search failed. Try again." };
  }
}
