"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, actionOk, formString, zodFieldErrors, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import {
  FACET_KINDS,
  convertTagsToFacet,
  createFacet,
  createFacetValue,
  deleteFacet,
  deleteFacetValue,
  mergeFacetValues,
  moveFacet,
  moveFacetValue,
  seedDefaultFacets,
  updateFacet,
  updateFacetValue,
} from "@/server/facets";
import { errorResult } from "../inventory/_data";
import { copy } from "./_copy";

const r = copy.result;
const PATH = "/admin/facets";
const id = z.string().min(1).max(64);

function done() {
  revalidatePath(PATH);
}

function fieldAware(err: unknown): ActionResult {
  const res = errorResult(err, r.failed);
  if (res.ok || !res.message) return res;
  if (/slug/i.test(res.message)) return actionFail(res.message, { slug: [res.message] });
  if (/parent|children|under itself/i.test(res.message)) return actionFail(res.message, { parentId: [res.message] });
  return res;
}

// ─── Facets ─────────────────────────────────────────────────────────────────

const facetSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, "Enter a name.").max(100, "Keep the name under 100 characters."),
  kind: z.enum(FACET_KINDS, "Choose a kind."),
  slug: z.string().trim().max(80, "Keep the slug under 80 characters."),
  currentSlug: z.string().optional(),
  regenerateSlug: z.boolean(),
  isFilterable: z.boolean(),
});

export async function saveFacetAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const parsed = facetSchema.safeParse({
    id: formString(formData, "id") || undefined,
    name: formString(formData, "name"),
    kind: formString(formData, "kind"),
    slug: formString(formData, "slug"),
    currentSlug: formString(formData, "currentSlug") || undefined,
    regenerateSlug: formData.get("regenerateSlug") === "on",
    isFilterable: formData.get("isFilterable") === "on",
  });
  if (!parsed.success) return actionFail(r.check, zodFieldErrors(parsed.error));
  const d = parsed.data;
  try {
    const ctx = await requireStaffContext();
    if (d.id) {
      await updateFacet(ctx, d.id, {
        name: d.name,
        kind: d.kind,
        isFilterable: d.isFilterable,
        ...(d.regenerateSlug ? { regenerateSlug: true } : d.slug && d.slug !== d.currentSlug ? { slug: d.slug } : {}),
      });
      done();
      return actionOk(r.facetSaved);
    }
    await createFacet(ctx, { name: d.name, kind: d.kind, isFilterable: d.isFilterable, slug: d.slug || undefined });
    done();
    return actionOk(r.facetCreated(d.name));
  } catch (err) {
    return fieldAware(err);
  }
}

export async function deleteFacetAction(formData: FormData): Promise<ActionResult> {
  const facetId = id.safeParse(formString(formData, "id"));
  if (!facetId.success) return actionFail(r.failed);
  try {
    await deleteFacet(await requireStaffContext(), facetId.data);
    done();
    return actionOk(r.facetDeleted);
  } catch (err) {
    return errorResult(err, r.failed);
  }
}

export async function moveFacetAction(formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id, index: z.coerce.number().int().min(0).max(10_000) }).safeParse({ id: formString(formData, "id"), index: formString(formData, "index") });
  if (!parsed.success) return actionFail(r.failed);
  try {
    await moveFacet(await requireStaffContext(), parsed.data.id, parsed.data.index);
    done();
    return actionOk(r.moved);
  } catch (err) {
    return errorResult(err, r.failed);
  }
}

export async function seedDefaultsAction(): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    const res = await seedDefaultFacets(ctx.tenantId, ctx.actor.id);
    done();
    return actionOk(r.seeded(res.facetsCreated, res.valuesCreated));
  } catch (err) {
    return errorResult(err, r.failed);
  }
}

// ─── Values ─────────────────────────────────────────────────────────────────

const valueSchema = z.object({
  id: id.optional(),
  facetId: id,
  name: z.string().trim().min(1, "Enter a name.").max(100, "Keep the name under 100 characters."),
  parentId: id.nullable(),
  slug: z.string().trim().max(80, "Keep the slug under 80 characters."),
  currentSlug: z.string().optional(),
  regenerateSlug: z.boolean(),
});

export async function saveValueAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const parsed = valueSchema.safeParse({
    id: formString(formData, "id") || undefined,
    facetId: formString(formData, "facetId"),
    name: formString(formData, "name"),
    parentId: formString(formData, "parentId") || null,
    slug: formString(formData, "slug"),
    currentSlug: formString(formData, "currentSlug") || undefined,
    regenerateSlug: formData.get("regenerateSlug") === "on",
  });
  if (!parsed.success) return actionFail(r.check, zodFieldErrors(parsed.error));
  const d = parsed.data;
  try {
    const ctx = await requireStaffContext();
    if (d.id) {
      await updateFacetValue(ctx, d.id, {
        name: d.name,
        parentId: d.parentId,
        ...(d.regenerateSlug ? { regenerateSlug: true } : d.slug && d.slug !== d.currentSlug ? { slug: d.slug } : {}),
      });
      done();
      return actionOk(r.valueSaved);
    }
    await createFacetValue(ctx, d.facetId, { name: d.name, parentId: d.parentId, slug: d.slug || undefined });
    done();
    return actionOk(r.valueCreated(d.name));
  } catch (err) {
    return fieldAware(err);
  }
}

export async function moveValueAction(formData: FormData): Promise<ActionResult> {
  const parsed = z
    .object({ id, parentId: id.nullable(), index: z.coerce.number().int().min(0).max(100_000) })
    .safeParse({ id: formString(formData, "id"), parentId: formString(formData, "parentId") || null, index: formString(formData, "index") });
  if (!parsed.success) return actionFail(r.failed);
  try {
    await moveFacetValue(await requireStaffContext(), parsed.data.id, { parentId: parsed.data.parentId, index: parsed.data.index });
    done();
    return actionOk(r.moved);
  } catch (err) {
    return errorResult(err, r.failed);
  }
}

export async function deleteValueAction(formData: FormData): Promise<ActionResult> {
  const valueId = id.safeParse(formString(formData, "id"));
  if (!valueId.success) return actionFail(r.failed);
  try {
    await deleteFacetValue(await requireStaffContext(), valueId.data);
    done();
    return actionOk(r.valueDeleted);
  } catch (err) {
    return errorResult(err, r.failed);
  }
}

export async function mergeValueAction(formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id, targetId: id }).safeParse({ id: formString(formData, "id"), targetId: formString(formData, "targetId") });
  if (!parsed.success) return actionFail(copy.valueForm.mergeTarget);
  try {
    await mergeFacetValues(await requireStaffContext(), [parsed.data.id], parsed.data.targetId);
    done();
    return actionOk(r.merged);
  } catch (err) {
    return errorResult(err, r.failed);
  }
}

// ─── Tags → facet ───────────────────────────────────────────────────────────

const convertSchema = z.object({
  tagIds: z.array(id).min(1, copy.convert.needTags).max(500),
  facetId: id.or(z.literal("").transform(() => null)).refine((v) => v !== null, copy.convert.needFacet),
  parentId: id.nullable(),
  deleteTags: z.boolean(),
});

export async function convertTagsAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const parsed = convertSchema.safeParse({
    tagIds: formData.getAll("tagIds").map(String),
    facetId: formString(formData, "facetId"),
    parentId: formString(formData, "parentId") || null,
    deleteTags: formData.get("deleteTags") === "on",
  });
  if (!parsed.success) return actionFail(r.check, zodFieldErrors(parsed.error));
  const d = parsed.data;
  try {
    const ctx = await requireStaffContext();
    const res = await convertTagsToFacet(ctx, d.tagIds, d.facetId!, { parentId: d.parentId, deleteTags: d.deleteTags });
    done();
    revalidatePath("/admin/categories");
    revalidatePath("/admin/inventory");
    return actionOk(r.converted(res.created, res.reused, res.linked, res.deletedTags));
  } catch (err) {
    return fieldAware(err);
  }
}
