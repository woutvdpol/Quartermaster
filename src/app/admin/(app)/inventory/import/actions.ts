"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError } from "@/server/auth/guards";
import { ServiceError, requireStaffContext } from "@/server/context";
import { cancelImport, deleteImportedDrafts, discardImport, getImportJob, retryImport, startImport, type ImportJobView } from "@/server/import";
import { importCopy as t } from "@/components/admin/import/copy";

/*
 * Server actions of the product import UI (src/components/admin/import/ProductImport.tsx), usable from
 * Inventory → Import and the setup wizard. The upload itself is a route handler (./upload/route.ts).
 * Every action re-checks the staff session; the services scope everything to the session's tenant.
 */

export type ImportActionResult = { ok: true; job: ImportJobView | null; message?: string } | { ok: false; message: string };

const jobId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const optionsSchema = z.object({
  publish: z.boolean(),
  tagsAs: z.enum(["facets", "tags"]),
  stockMode: z.enum(["split", "single"]),
  images: z.boolean(),
});

function fail(err: unknown): ImportActionResult {
  if (err instanceof AuthError) return { ok: false, message: err.code === "UNAUTHENTICATED" ? t.errors.unauthenticated : t.errors.forbidden };
  if (err instanceof ServiceError) return { ok: false, message: err.code === "FORBIDDEN" ? t.errors.forbidden : err.message };
  if (err instanceof z.ZodError) return { ok: false, message: t.errors.generic };
  console.error("[inventory/import]", err);
  return { ok: false, message: t.errors.generic };
}

export async function getImportStatusAction(id: string): Promise<ImportActionResult> {
  try {
    const ctx = await requireStaffContext();
    return { ok: true, job: await getImportJob(ctx, jobId.parse(id)) };
  } catch (err) {
    return fail(err);
  }
}

export async function startImportAction(id: string, options: z.input<typeof optionsSchema>): Promise<ImportActionResult> {
  try {
    const ctx = await requireStaffContext();
    const job = await startImport(ctx, jobId.parse(id), optionsSchema.parse(options));
    revalidatePath("/admin/inventory");
    return { ok: true, job };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelImportAction(id: string): Promise<ImportActionResult> {
  try {
    const ctx = await requireStaffContext();
    return { ok: true, job: await cancelImport(ctx, jobId.parse(id)) };
  } catch (err) {
    return fail(err);
  }
}

export async function retryImportAction(id: string): Promise<ImportActionResult> {
  try {
    const ctx = await requireStaffContext();
    return { ok: true, job: await retryImport(ctx, jobId.parse(id)) };
  } catch (err) {
    return fail(err);
  }
}

export async function discardImportAction(id: string): Promise<ImportActionResult> {
  try {
    const ctx = await requireStaffContext();
    await discardImport(ctx, jobId.parse(id));
    return { ok: true, job: null };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteImportedDraftsAction(id: string): Promise<ImportActionResult> {
  try {
    const ctx = await requireStaffContext();
    const res = await deleteImportedDrafts(ctx, jobId.parse(id));
    revalidatePath("/admin/inventory");
    return { ok: true, job: await getImportJob(ctx, id), message: t.result.undone(res.deleted, res.kept) };
  } catch (err) {
    return fail(err);
  }
}
