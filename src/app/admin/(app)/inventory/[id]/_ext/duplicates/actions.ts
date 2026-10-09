"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, actionOk, type ActionResult } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { checkDuplicates, copyProvenanceFromPrevious, setPreviousProduct } from "@/server/duplicates";
import { requireTenantDisplay } from "@/server/tenant-display";
import { failFromError } from "../../_lib/errors";
import { productEditPath } from "../../_copy";
import { dupCopy } from "./_copy";
import { monthLabel } from "./format";

const id = z.string().min(1).max(64);

export type DuplicateCandidateView = {
  productId: string;
  stockCode: number;
  title: string;
  /** "sold Jul 2026", "draft", "in stock", … */
  statusLabel: string;
  thumbUrl: string | null;
  band: "very_close" | "close";
  isPrevious: boolean;
};

/**
 * Runs after photo uploads finished (PhotosCard). Best effort: any problem (embedder down, slow,
 * invalid input) yields an empty list — the panel simply does not appear.
 */
export async function checkDuplicatesAction(productId: string, imageIds: string[]): Promise<DuplicateCandidateView[]> {
  const parsed = z.object({ productId: id, imageIds: z.array(id).min(1).max(100) }).safeParse({ productId, imageIds });
  if (!parsed.success) return [];
  try {
    const ctx = await requireStaffContext();
    const [result, tenant] = await Promise.all([checkDuplicates(ctx, parsed.data), requireTenantDisplay(ctx.tenantId)]);
    return result.candidates.map((c) => ({
      productId: c.productId,
      stockCode: c.stockCode,
      title: c.title,
      statusLabel: dupCopy.status(c.status, c.soldAt ? monthLabel(c.soldAt, tenant.timeZone) : null),
      thumbUrl: c.thumbUrl,
      band: c.band,
      isPrevious: c.isPrevious,
    }));
  } catch (err) {
    console.warn("[duplicates] check failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** "The same piece came back": link (or with null unlink) the earlier listing. */
export async function setEarlierListingAction(productId: string, previousProductId: string | null): Promise<ActionResult> {
  const parsed = z.object({ productId: id, previousProductId: id.nullable() }).safeParse({ productId, previousProductId });
  if (!parsed.success) return actionFail(dupCopy.failed);
  try {
    const ctx = await requireStaffContext();
    const lineage = await setPreviousProduct(ctx, parsed.data.productId, parsed.data.previousProductId);
    revalidatePath(productEditPath(parsed.data.productId));
    if (parsed.data.previousProductId) revalidatePath(productEditPath(parsed.data.previousProductId));
    return actionOk(lineage.previous ? dupCopy.linkedToast(lineage.previous.stockCode) : dupCopy.unlinked);
  } catch (err) {
    return failFromError(err);
  }
}

/** "Copy provenance from No. X" (only on request, never silently). */
export async function copyProvenanceAction(productId: string): Promise<ActionResult> {
  const parsed = id.safeParse(productId);
  if (!parsed.success) return actionFail(dupCopy.failed);
  try {
    const ctx = await requireStaffContext();
    const { copied } = await copyProvenanceFromPrevious(ctx, parsed.data);
    revalidatePath(productEditPath(parsed.data));
    return actionOk(copied ? dupCopy.copied : dupCopy.nothingToCopy);
  } catch (err) {
    return failFromError(err);
  }
}
