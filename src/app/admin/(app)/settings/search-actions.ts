"use server";

import { actionOk, type ActionResult } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { getSearchIndexOverview, requestReindex, type SearchIndexOverview } from "@/server/search";
import { failFrom } from "../_system/errors";

/** Index coverage + latest rebuild (polled by the card while a rebuild runs). */
export async function searchIndexOverviewAction(): Promise<SearchIndexOverview | null> {
  try {
    return await getSearchIndexOverview(await requireStaffContext());
  } catch {
    return null;
  }
}

/** Settings → Catalog → "Rebuild search index". `force` re-embeds every product (after a model change). */
export async function rebuildSearchIndexAction(force: boolean): Promise<ActionResult<string, SearchIndexOverview>> {
  try {
    const ctx = await requireStaffContext();
    await requestReindex(ctx, { force: force === true });
    return actionOk<SearchIndexOverview>("Search index rebuild queued.", await getSearchIndexOverview(ctx));
  } catch (err) {
    return { ok: false, message: failFrom(err).message };
  }
}
